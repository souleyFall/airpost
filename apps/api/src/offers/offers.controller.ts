import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Prisma } from '../generated/prisma/client';
import { ContractType, OfferSource } from '../generated/prisma/enums';
import { MatchService } from '../matching/match.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';

// Dérivés de l'énumération de la base : une nouvelle source ou un nouveau contrat ne peut pas être oublié ici
// (une liste recopiée à la main avait fait refuser « GOOGLE_JOBS » par le filtre).
const SOURCES = Object.values(OfferSource) as [OfferSource, ...OfferSource[]];
const CONTRACTS = Object.values(ContractType) as [ContractType, ...ContractType[]];

/** « A,B » → ['A', 'B'] ; vide ou absent → []. Les valeurs inconnues sont refusées par l'énumération. */
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(values)).max(values.length));

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  maxDistanceKm: z.coerce.number().min(0).max(1000).optional(),
  /** Recherche libre dans l'intitulé, l'entreprise, la ville et la description. */
  q: z.string().trim().max(100).optional(),
  source: csv(SOURCES),
  contract: csv(CONTRACTS),
  channel: z.enum(['EMAIL', 'SITE']).optional(),
  /** Vrai : seulement les offres à traiter (sans candidature, ou lettre à relire). */
  pending: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  sort: z.enum(['score', 'fresh', 'distance']).default('score'),
});
type ListQuery = z.infer<typeof listQuery>;

/** Les offres affichées à l'écran : une page au plus. */
const analyzeBody = z.object({ ids: z.array(z.uuid()).min(1).max(100) });
type AnalyzeBody = z.infer<typeof analyzeBody>;

/** Protège \, % et _ pour qu'une recherche « 100% » ne soit pas un motif. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const SORTS: Record<ListQuery['sort'], Prisma.OfferOrderByWithRelationInput[]> = {
  score: [{ score: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
  fresh: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
  distance: [{ distanceKm: { sort: 'asc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
};

// Pas de @Public() : session obligatoire (garde global).
@Controller('offers')
export class OffersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly matching: MatchService,
  ) {}

  /** Offres filtrées, triées et paginées, sans la description (volumineuse). */
  @Get()
  async list(@Query(new ZodValidationPipe(listQuery)) query: ListQuery) {
    const and: Prisma.OfferWhereInput[] = [];
    if (query.minScore > 0) and.push({ score: { gte: query.minScore } });
    if (query.maxDistanceKm !== undefined) {
      // Une offre non localisée n'est pas écartée : on ne sait pas qu'elle est trop loin.
      and.push({ OR: [{ distanceKm: null }, { distanceKm: { lte: query.maxDistanceKm } }] });
    }
    if (query.source.length > 0) and.push({ source: { in: query.source } });
    if (query.contract.length > 0) and.push({ contractType: { in: query.contract } });
    if (query.channel) and.push({ channel: query.channel });
    if (query.pending) {
      and.push({ OR: [{ application: null }, { application: { status: 'TO_REVIEW' } }] });
      // Écartées par l'IA : hors du fil, sauf si tu as déjà commencé une candidature dessus.
      and.push({ OR: [{ excluded: false }, { application: { isNot: null } }] });
    }
    if (query.q) {
      // % et _ sont des jokers du LIKE de PostgreSQL : saisis par l'utilisateur, ils doivent être pris au pied de la lettre.
      const contains = { contains: escapeLike(query.q), mode: 'insensitive' as const };
      and.push({
        OR: [
          { title: contains },
          { company: contains },
          { city: contains },
          { description: contains },
        ],
      });
    }
    const where: Prisma.OfferWhereInput = and.length > 0 ? { AND: and } : {};

    // Une seule transaction : le total et la page décrivent le même état de la base.
    const [total, items] = await this.prisma.$transaction([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({
        where,
        // id en dernier départage les ex æquo : sans lui, des pages successives peuvent répéter ou manquer des offres.
        orderBy: [...SORTS[query.sort], { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
        select: {
          id: true,
          source: true,
          title: true,
          company: true,
          city: true,
          postcode: true,
          channel: true,
          via: true,
          contractType: true,
          distanceKm: true,
          applyUrl: true,
          publishedAt: true,
          firstSeenAt: true,
          score: true,
          // Permet à l'interface de savoir quelles offres ont déjà une lettre, et à quel stade.
          application: { select: { id: true, status: true } },
        },
      }),
    ]);
    return { total, limit: query.limit, offset: query.offset, items };
  }

  /**
   * Analyse en une fois les offres affichées qui n'ont pas de note à jour (l'interface l'appelle dès que la liste
   * s'affiche). Renvoie la note de chacune. Un quota atteint n'est pas une erreur : les offres restent sans note.
   */
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('analyze')
  @HttpCode(200)
  async analyzeVisible(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(analyzeBody)) body: AnalyzeBody,
  ) {
    const profile = await this.profiles.get(req.auth.userId);
    if (!profile) {
      throw new BadRequestException('Renseigne ton profil avant de lancer une analyse');
    }
    const report = await this.matching.analyzePending(profile, body.ids.length, body.ids);
    const items = await this.prisma.offer.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, score: true, excluded: true },
    });
    return { ...report, items };
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id },
      // Champs techniques (dedupKey, empreinte du profil...) exclus : l'interface ne doit pas en dépendre.
      select: {
        id: true,
        source: true,
        externalId: true,
        title: true,
        company: true,
        city: true,
        postcode: true,
        latitude: true,
        longitude: true,
        description: true,
        applyUrl: true,
        contactEmail: true,
        channel: true,
        via: true,
        contractType: true,
        distanceKm: true,
        publishedAt: true,
        firstSeenAt: true,
        lastSeenAt: true,
        score: true,
        analysis: true,
        analyzedAt: true,
        excluded: true,
        application: { select: { id: true, status: true } },
      },
    });
    if (!offer) {
      throw new NotFoundException('Offre introuvable');
    }
    return offer;
  }

  /**
   * Analyse l'offre par le modèle si elle ne l'est pas (ou plus, le profil ayant changé) ; `force=true` la refait.
   * Limité : chaque appel consomme le quota du modèle. Renvoie l'offre à jour.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/analyze')
  @HttpCode(200)
  async analyze(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('force') force?: string,
  ) {
    const profile = await this.profiles.get(req.auth.userId);
    if (!profile) {
      throw new BadRequestException('Renseigne ton profil avant de lancer une analyse');
    }
    await this.matching.analyzeOne(profile, id, force === 'true');
    return this.get(id);
  }
}
