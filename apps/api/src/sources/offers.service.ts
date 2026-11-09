import { Injectable } from '@nestjs/common';
import type { OfferSource } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { dedupKey } from './dedup';
import { planCleanup } from './cleanup';
import { type Position, roundedDistance } from './geo';
import { detectContractType } from './relevance';
import type { NormalizedOffer } from './source.types';

/** Mises à jour envoyées par lots : une transaction de plusieurs centaines d'écritures reste raisonnable. */
const BATCH_SIZE = 200;

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
   * Supprime les offres qui ne sont plus apparues depuis plus de `days` jours (durée de conservation, RGPD).
   * Une offre toujours publiée est revue à chaque collecte et donc conservée (purger sur la première apparition
   * la supprimerait puis la recréerait en boucle).
   * Une offre qui a une candidature n'est JAMAIS supprimée : elle fait partie du suivi de l'utilisateur
   * (elle partira avec sa candidature). Renvoie le nombre d'offres supprimées.
   */
  async purgeStale(days: number, now = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.offer.deleteMany({
      where: { lastSeenAt: { lt: limit }, application: null },
    });
    return count;
  }

  /**
   * Applique les règles actuelles aux offres déjà enregistrées : supprime celles qui ne concernent pas le développement
   * (sauf si elles ont une candidature : elles font partie du suivi) et corrige le type de contrat.
   * trusted : sources déjà filtrées à la source, jamais supprimées ici.
   */
  async cleanup(trusted: readonly OfferSource[]): Promise<{ removed: number; updated: number }> {
    const offers = await this.prisma.offer.findMany({
      where: { application: null },
      select: { id: true, source: true, title: true, description: true, contractType: true },
    });
    const plan = planCleanup(offers, new Set(trusted));
    const { count } = plan.deleteIds.length
      ? await this.prisma.offer.deleteMany({
          where: { id: { in: plan.deleteIds }, application: null },
        })
      : { count: 0 };
    for (let i = 0; i < plan.contractUpdates.length; i += BATCH_SIZE) {
      await this.prisma.$transaction(
        plan.contractUpdates.slice(i, i + BATCH_SIZE).map((u) =>
          this.prisma.offer.update({
            where: { id: u.id },
            data: { contractType: u.contractType },
          }),
        ),
      );
    }
    return { removed: count, updated: plan.contractUpdates.length };
  }

  /** Recalcule la distance à vol d'oiseau de chaque offre localisée (le domicile peut changer avec le profil). */
  async refreshDistances(home: Position): Promise<number> {
    const offers = await this.prisma.offer.findMany({
      select: { id: true, latitude: true, longitude: true, distanceKm: true },
    });
    const changed = offers
      .map((o) => ({
        id: o.id,
        previous: o.distanceKm,
        km: roundedDistance(home, o.latitude, o.longitude),
      }))
      .filter((o) => o.km !== o.previous);
    for (let i = 0; i < changed.length; i += BATCH_SIZE) {
      await this.prisma.$transaction(
        changed
          .slice(i, i + BATCH_SIZE)
          .map((o) =>
            this.prisma.offer.update({ where: { id: o.id }, data: { distanceKm: o.km } }),
          ),
      );
    }
    return changed.length;
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
          contractType: detectContractType(o.title, o.description, o.source),
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
