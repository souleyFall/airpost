import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
});
type ListQuery = z.infer<typeof listQuery>;

// Pas de @Public() : session obligatoire (garde global). Lecture seule.
@Controller('offers')
export class OffersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Offres classées par score décroissant (les non notées à la fin), sans la description (volumineuse). */
  @Get()
  async list(@Query(new ZodValidationPipe(listQuery)) query: ListQuery) {
    // Sans score minimum, tout est listé, y compris les offres pas encore notées (score nul).
    const where = query.minScore > 0 ? { score: { gte: query.minScore } } : {};
    // Une seule transaction : le total et la page décrivent le même état de la base.
    const [total, items] = await this.prisma.$transaction([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({
        where,
        // id en dernier départage les ex æquo : sans lui, des pages successives peuvent répéter ou manquer des offres.
        orderBy: [
          { score: { sort: 'desc', nulls: 'last' } },
          { firstSeenAt: 'desc' },
          { id: 'asc' },
        ],
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
          applyUrl: true,
          publishedAt: true,
          firstSeenAt: true,
          score: true,
          scoreDetail: true,
        },
      }),
    ]);
    return { total, items };
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id },
      // Champs techniques (dedupKey...) exclus : l'interface ne doit pas en dépendre.
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
        publishedAt: true,
        firstSeenAt: true,
        lastSeenAt: true,
        score: true,
        scoreDetail: true,
      },
    });
    if (!offer) {
      throw new NotFoundException('Offre introuvable');
    }
    return offer;
  }
}
