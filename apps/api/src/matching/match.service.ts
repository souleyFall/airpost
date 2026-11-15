import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { LlmService } from '../llm/llm.service';
import { translateLlmError } from '../llm/llm-http';
import { LlmError } from '../llm/llm.types';
import { PrismaService } from '../prisma/prisma.service';
import type { Profile } from '../profile/profile.schema';
import {
  BATCH_SIZE,
  MATCH_SYSTEM,
  type MatchItem,
  type OfferForMatch,
  type StoredAnalysis,
  buildMatchPrompt,
  matchBatchSchema,
  matchFingerprint,
  verdictOf,
} from './match.prompt';

/** Plafond d'offres analysées par collecte : le quota gratuit du modèle est limité, le reste suit à la collecte suivante. */
export const MAX_ANALYSES_PER_RUN = 40;

const OFFER_SELECT = {
  id: true,
  source: true,
  via: true,
  contractType: true,
  title: true,
  company: true,
  city: true,
  distanceKm: true,
  publishedAt: true,
  firstSeenAt: true,
  description: true,
} as const;

export interface AnalysisReport {
  /** Offres analysées avec succès. */
  analyzed: number;
  /** Offres qui attendent encore une analyse (plafond atteint ou quota du modèle épuisé). */
  remaining: number;
}

@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Offres à analyser : sans analyse à jour (jamais analysées, ou analysées avec un autre profil/prompt) ET dont le
   * type de contrat est un de ceux que l'utilisateur recherche (alternance, stage...). Une offre dont le contrat n'est
   * pas précisé (ou autre : CDI, CDD) n'est pas envoyée au modèle : elle reste en fin de liste, sans note, et
   * n'est analysée que si l'utilisateur l'ouvre. Le type de contrat est déduit du texte de l'annonce (voir
   * `detectContractType` : alternance, apprentissage, stage...), donc le tri ne coûte aucune requête.
   */
  private pendingWhere(fingerprint: string, profile: Profile): Prisma.OfferWhereInput {
    return {
      AND: [
        { OR: [{ analyzedAt: null }, { profileHash: { not: fingerprint } }] },
        { contractType: { in: profile.search.contracts } },
        // Une offre rejetée n'est pas analysée : ce serait un appel au modèle (donc du quota) pour rien.
        { rejectedAt: null },
      ],
    };
  }

  /**
   * Analyse les offres qui n'ont pas d'analyse à jour, les plus récentes d'abord. Une erreur du modèle n'interrompt
   * pas la collecte : un quota atteint ou une clé invalide arrête la boucle, une réponse inexploitable passe au lot suivant.
   */
  async analyzePending(
    profile: Profile,
    max = MAX_ANALYSES_PER_RUN,
    /** Se limiter à ces offres (celles que l'utilisateur voit à l'écran). */
    ids?: string[],
  ): Promise<AnalysisReport> {
    const fingerprint = matchFingerprint(profile);
    const pending = this.pendingWhere(fingerprint, profile);
    const where: Prisma.OfferWhereInput = ids ? { AND: [pending, { id: { in: ids } }] } : pending;
    const offers = await this.prisma.offer.findMany({
      where,
      orderBy: [{ firstSeenAt: 'desc' }, { id: 'asc' }],
      take: max,
      select: OFFER_SELECT,
    });

    let analyzed = 0;
    for (let i = 0; i < offers.length; i += BATCH_SIZE) {
      const batch = offers.slice(i, i + BATCH_SIZE);
      try {
        analyzed += await this.analyzeBatch(profile, fingerprint, batch);
      } catch (error) {
        if (
          error instanceof LlmError &&
          ['rate_limited', 'not_configured', 'unauthorized', 'model_unavailable'].includes(
            error.reason,
          )
        ) {
          break;
        }
        // Réponse inexploitable ou service en panne : ce lot sera retenté à la prochaine collecte.
      }
    }
    const remaining = await this.prisma.offer.count({ where });
    this.logger.log(`Analyse IA : ${analyzed} offre(s) analysée(s), ${remaining} en attente.`);
    return { analyzed, remaining };
  }

  /** Analyse (ou réanalyse, si `force`) une offre à la demande, quand l'utilisateur l'ouvre. */
  async analyzeOne(profile: Profile, offerId: string, force = false): Promise<void> {
    const fingerprint = matchFingerprint(profile);
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      select: { ...OFFER_SELECT, analyzedAt: true, profileHash: true },
    });
    if (!offer) {
      throw new NotFoundException('Offre introuvable');
    }
    if (!force && offer.analyzedAt && offer.profileHash === fingerprint) {
      return;
    }
    try {
      // Forcer = vouloir un autre avis : pas de réponse en mémoire.
      const done = await this.analyzeBatch(profile, fingerprint, [offer], !force);
      if (done === 0) {
        throw new LlmError('invalid_output', 'Analyse inexploitable.');
      }
    } catch (error) {
      throw translateLlmError(error);
    }
  }

  private async analyzeBatch(
    profile: Profile,
    fingerprint: string,
    batch: OfferForMatch[],
    useCache = true,
  ): Promise<number> {
    const response = await this.llm.generateObject({
      system: MATCH_SYSTEM,
      user: buildMatchPrompt(profile, batch),
      schema: matchBatchSchema,
      // Bas : on veut des notes reproductibles, pas de la créativité.
      temperature: 0.1,
      maxOutputTokens: 4_096,
      useCache,
    });

    // Un numéro absent, répété ou hors plage est ignoré : l'offre concernée sera retentée.
    const byNumber = new Map<number, MatchItem>();
    for (const item of response.results) {
      if (item.n <= batch.length && !byNumber.has(item.n)) {
        byNumber.set(item.n, item);
      }
    }

    let saved = 0;
    for (const [index, offer] of batch.entries()) {
      const item = byNumber.get(index + 1);
      if (!item) continue;
      // Filet de sécurité : une offre écartée ne peut pas avoir une bonne note, quoi qu'écrive le modèle.
      const score = item.disqualifier ? Math.min(item.score, 35) : item.score;
      const analysis: StoredAnalysis = {
        summary: item.summary,
        disqualifier: item.disqualifier,
        strengths: item.strengths,
        gaps: item.gaps,
        brief: item.brief,
        verdict: verdictOf(score, item.disqualifier),
      };
      await this.prisma.offer.update({
        where: { id: offer.id },
        data: {
          score,
          analysis: analysis,
          analyzedAt: new Date(),
          profileHash: fingerprint,
          // Écartée par l'IA : masquée du fil. Recalculé à chaque analyse (un nouveau profil peut la rendre pertinente).
          excluded: analysis.verdict === 'off_target',
        },
      });
      saved++;
    }
    return saved;
  }
}
