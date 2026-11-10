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

/**
 * Sources dont l'identifiant d'annonce change d'une recherche à l'autre (Google Jobs : hors du cache d'une heure de SerpApi,
 * la même annonce revient avec un autre job_id). Pour elles, l'identité d'une offre est l'empreinte (entreprise, intitulé,
 * ville) : sans cela chaque collecte recréerait les mêmes annonces.
 */
const UNSTABLE_ID_SOURCES: readonly OfferSource[] = ['GOOGLE_JOBS'];

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
      select: {
        id: true,
        source: true,
        title: true,
        company: true,
        description: true,
        contractType: true,
      },
    });
    const plan = planCleanup(offers, new Set(trusted));
    const duplicates = await this.duplicateIds();
    for (const id of duplicates) {
      if (!plan.deleteIds.includes(id)) plan.deleteIds.push(id);
    }
    // Une ligne supprimée n'a plus de contrat à corriger (la mise à jour échouerait : ligne introuvable).
    const deleted = new Set(plan.deleteIds);
    plan.contractUpdates = plan.contractUpdates.filter((u) => !deleted.has(u.id));
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

  /**
   * Doublons laissés par les sources à identifiant instable (même empreinte, plusieurs lignes) : on garde une ligne par
   * annonce, de préférence celle qui a une analyse, puis la plus ancienne. Les offres qui ont une candidature ne sont
   * jamais supprimées.
   */
  private async duplicateIds(): Promise<string[]> {
    const rows = await this.prisma.offer.findMany({
      where: { source: { in: [...UNSTABLE_ID_SOURCES] } },
      select: {
        id: true,
        source: true,
        dedupKey: true,
        analyzedAt: true,
        firstSeenAt: true,
        application: { select: { id: true } },
      },
      orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
    });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.source}:${row.dedupKey}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const toDelete: string[] = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const keeper =
        group.find((r) => r.application) ?? group.find((r) => r.analyzedAt) ?? group[0];
      for (const row of group) {
        if (row !== keeper && !row.application) toDelete.push(row.id);
      }
    }
    return toDelete;
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
   * Pour les sources à identifiant instable (voir UNSTABLE_ID_SOURCES), une offre déjà connue sous un autre
   * identifiant mais avec la même empreinte est elle aussi mise à jour (et non recréée en double).
   */
  async saveMany(offers: NormalizedOffer[]): Promise<SaveResult> {
    // Une même offre peut apparaître deux fois dans un lot : la dernière version l'emporte.
    const byId = [...new Map(offers.map((o) => [`${o.source}:${o.externalId}`, o])).values()];
    // Source à identifiant instable : la même annonce peut aussi revenir sous deux identifiants dans le même lot.
    const seenKeys = new Set<string>();
    const unique = byId.filter((o) => {
      if (!UNSTABLE_ID_SOURCES.includes(o.source)) return true;
      const key = `${o.source}:${dedupKey(o.company, o.title, o.city)}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    if (unique.length === 0) {
      return { created: 0, updated: 0 };
    }

    const existing = await this.prisma.offer.findMany({
      where: { OR: unique.map((o) => ({ source: o.source, externalId: o.externalId })) },
      select: { source: true, externalId: true },
    });
    const known = new Set(existing.map((o) => `${o.source}:${o.externalId}`));

    // Offres inconnues par identifiant mais connues par empreinte (sources à identifiant instable seulement).
    const unknownUnstable = unique.filter(
      (o) => UNSTABLE_ID_SOURCES.includes(o.source) && !known.has(`${o.source}:${o.externalId}`),
    );
    const idByKey = new Map<string, string>();
    if (unknownUnstable.length > 0) {
      const sameKey = await this.prisma.offer.findMany({
        where: {
          OR: unknownUnstable.map((o) => ({
            source: o.source,
            dedupKey: dedupKey(o.company, o.title, o.city),
          })),
        },
        select: { id: true, source: true, dedupKey: true },
        orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
      });
      for (const row of sameKey) {
        const key = `${row.source}:${row.dedupKey}`;
        if (!idByKey.has(key)) idByKey.set(key, row.id);
      }
    }
    const now = new Date();
    let created = 0;

    await this.prisma.$transaction(
      unique.map((o) => {
        const key = dedupKey(o.company, o.title, o.city);
        const data = {
          title: o.title,
          company: o.company,
          dedupKey: key,
          city: o.city ?? null,
          postcode: o.postcode ?? null,
          latitude: o.latitude ?? null,
          longitude: o.longitude ?? null,
          description: o.description ?? null,
          applyUrl: o.applyUrl ?? null,
          contactEmail: o.contactEmail ?? null,
          channel: o.channel,
          via: o.via ?? null,
          contractType: detectContractType(o.title, o.description, o.source),
          publishedAt: o.publishedAt ?? null,
          lastSeenAt: now,
        };
        const sameOffer = idByKey.get(`${o.source}:${key}`);
        if (!known.has(`${o.source}:${o.externalId}`) && sameOffer) {
          // Même annonce revenue sous un autre identifiant : on met à jour la ligne existante (identifiant conservé).
          return this.prisma.offer.update({ where: { id: sameOffer }, data });
        }
        if (!known.has(`${o.source}:${o.externalId}`)) created++;
        return this.prisma.offer.upsert({
          where: { source_externalId: { source: o.source, externalId: o.externalId } },
          update: data,
          create: { source: o.source, externalId: o.externalId, ...data },
        });
      }),
    );

    return { created, updated: unique.length - created };
  }
}
