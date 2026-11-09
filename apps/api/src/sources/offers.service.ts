import { Injectable } from '@nestjs/common';
import type { OfferSource } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { dedupKey } from './dedup';
import type { NormalizedOffer } from './source.types';

export interface SaveResult {
  created: number;
  updated: number;
}

@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sources qui possèdent déjà une offre portant chacune de ces empreintes (clé → sources). */
  async sourcesByDedupKey(keys: string[]): Promise<Map<string, Set<OfferSource>>> {
    const result = new Map<string, Set<OfferSource>>();
    if (keys.length === 0) {
      return result;
    }
    const rows = await this.prisma.offer.findMany({
      where: { dedupKey: { in: keys } },
      select: { dedupKey: true, source: true },
    });
    for (const row of rows) {
      const sources = result.get(row.dedupKey) ?? new Set<OfferSource>();
      sources.add(row.source);
      result.set(row.dedupKey, sources);
    }
    return result;
  }

  /**
   * Supprime les offres vues pour la première fois il y a plus de `days` jours (durée de conservation, RGPD).
   * Une offre qui a une candidature n'est JAMAIS supprimée : elle fait partie du suivi de l'utilisateur
   * (elle partira avec sa candidature). Renvoie le nombre d'offres supprimées.
   */
  async purgeStale(days: number, now = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.offer.deleteMany({
      where: { firstSeenAt: { lt: limit }, application: null },
    });
    return count;
  }

  /**
   * Enregistre des offres. Une offre déjà connue (même source, même identifiant) est mise à jour et sa date
   * de dernière apparition rafraîchie ; le score et la candidature associée ne sont jamais touchés.
   */
  async saveMany(offers: NormalizedOffer[]): Promise<SaveResult> {
    // Une même offre peut apparaître deux fois dans un lot : la dernière version l'emporte.
    const unique = [...new Map(offers.map((o) => [`${o.source}:${o.externalId}`, o])).values()];
    if (unique.length === 0) {
      return { created: 0, updated: 0 };
    }

    const existing = await this.prisma.offer.findMany({
      where: { OR: unique.map((o) => ({ source: o.source, externalId: o.externalId })) },
      select: { source: true, externalId: true },
    });
    const known = new Set(existing.map((o) => `${o.source}:${o.externalId}`));
    const now = new Date();

    await this.prisma.$transaction(
      unique.map((o) => {
        const data = {
          title: o.title,
          company: o.company,
          dedupKey: dedupKey(o.company, o.title, o.city),
          city: o.city ?? null,
          postcode: o.postcode ?? null,
          latitude: o.latitude ?? null,
          longitude: o.longitude ?? null,
          description: o.description ?? null,
          applyUrl: o.applyUrl ?? null,
          contactEmail: o.contactEmail ?? null,
          channel: o.channel,
          publishedAt: o.publishedAt ?? null,
          lastSeenAt: now,
        };
        return this.prisma.offer.upsert({
          where: { source_externalId: { source: o.source, externalId: o.externalId } },
          update: data,
          create: { source: o.source, externalId: o.externalId, ...data },
        });
      }),
    );

    const created = unique.filter((o) => !known.has(`${o.source}:${o.externalId}`)).length;
    return { created, updated: unique.length - created };
  }
}
