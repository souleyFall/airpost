import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
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

/** Durée pendant laquelle une offre rejetée reste restaurable ; ensuite son contenu est vidé. */
export const REJECTED_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SaveResult {
  created: number;
  updated: number;
}

export interface RejectedOffer {
  id: string;
  title: string;
  company: string;
  city: string | null;
  postcode: string | null;
  contractType: string;
  score: number | null;
  rejectedAt: Date;
  /** Date à laquelle le contenu sera vidé si l'offre n'est pas restaurée. */
  expiresAt: Date;
  /** Une lettre avait été générée : elle est supprimée avec l'offre. */
  hasLetter: boolean;
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
   * Rejette une offre sans générer de lettre : elle quitte « À valider » mais reste restaurable 7 jours.
   * Refusé si une candidature est déjà avancée (validée, envoyée...) : elle se gère alors depuis le suivi.
   * Sans effet si l'offre est déjà rejetée.
   */
  async reject(id: string, now = new Date()): Promise<void> {
    const offer = await this.prisma.offer.findUnique({
      where: { id },
      select: { rejectedAt: true, application: { select: { status: true } } },
    });
    if (!offer) {
      throw new NotFoundException('Offre introuvable');
    }
    if (offer.application && offer.application.status !== 'TO_REVIEW') {
      throw new ConflictException(
        'Cette offre est déjà en suivi : change son statut depuis la page Suivi',
      );
    }
    if (offer.rejectedAt) return;
    await this.prisma.offer.updateMany({
      where: { id, rejectedAt: null },
      data: { rejectedAt: now },
    });
  }

  /** Remet une offre rejetée dans « À valider », tant que son contenu n'a pas été vidé. */
  async restore(id: string, now = new Date()): Promise<void> {
    const offer = await this.prisma.offer.findUnique({
      where: { id },
      select: { rejectedAt: true },
    });
    if (!offer) {
      throw new NotFoundException('Offre introuvable');
    }
    if (!offer.rejectedAt) return;
    const { count } = await this.prisma.offer.updateMany({
      where: { id, rejectedAt: { gte: this.rejectionLimit(now) } },
      data: { rejectedAt: null },
    });
    if (count === 0) {
      throw new ConflictException(
        `Trop tard : une offre rejetée est supprimée au bout de ${REJECTED_RETENTION_DAYS} jours`,
      );
    }
  }

  /** Offres rejetées encore restaurables, les plus récemment rejetées d'abord. Vide d'abord celles qui ont expiré. */
  async listRejected(now = new Date()): Promise<RejectedOffer[]> {
    await this.purgeRejected(now);
    const rows = await this.prisma.offer.findMany({
      where: { rejectedAt: { gte: this.rejectionLimit(now) } },
      orderBy: [{ rejectedAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        company: true,
        city: true,
        postcode: true,
        contractType: true,
        score: true,
        rejectedAt: true,
        application: { select: { id: true } },
      },
    });
    return rows.map(({ application, rejectedAt, ...offer }) => ({
      ...offer,
      rejectedAt: rejectedAt as Date,
      expiresAt: new Date((rejectedAt as Date).getTime() + REJECTED_RETENTION_DAYS * DAY_MS),
      hasLetter: application !== null,
    }));
  }

  /**
   * Vide les offres rejetées depuis plus de 7 jours : lettre, description, analyse, contact et lien disparaissent.
   * Seule l'identité de l'offre (intitulé, entreprise, empreinte) est gardée : sans elle, la collecte suivante la
   * réimporterait comme une offre neuve. Cette trace part avec la purge normale quand l'offre n'est plus publiée.
   * Renvoie le nombre d'offres vidées.
   */
  async purgeRejected(now = new Date()): Promise<number> {
    const expired = { rejectedAt: { lt: this.rejectionLimit(now) } };
    const [, cleared] = await this.prisma.$transaction([
      this.prisma.application.deleteMany({ where: { status: 'TO_REVIEW', offer: expired } }),
      this.prisma.offer.updateMany({
        where: {
          ...expired,
          OR: [
            { description: { not: null } },
            { contactEmail: { not: null } },
            { applyUrl: { not: null } },
            { analyzedAt: { not: null } },
            { score: { not: null } },
          ],
        },
        data: {
          description: null,
          contactEmail: null,
          applyUrl: null,
          analysis: Prisma.DbNull,
          analyzedAt: null,
          score: null,
        },
      }),
    ]);
    return cleared.count;
  }

  private rejectionLimit(now: Date): Date {
    return new Date(now.getTime() - REJECTED_RETENTION_DAYS * DAY_MS);
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
      select: { source: true, externalId: true, rejectedAt: true },
    });
    const known = new Set(existing.map((o) => `${o.source}:${o.externalId}`));
    // Offres rejetées : la collecte ne rafraîchit que leur date de dernière apparition. Sans cela, elle remplirait de
    // nouveau la description d'une offre dont le contenu a été vidé (et la ferait revenir à l'écran).
    const rejected = new Set(
      existing.filter((o) => o.rejectedAt).map((o) => `${o.source}:${o.externalId}`),
    );
    const rejectedIds = new Set<string>();

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
        select: { id: true, source: true, dedupKey: true, rejectedAt: true },
        orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
      });
      for (const row of sameKey) {
        const key = `${row.source}:${row.dedupKey}`;
        if (!idByKey.has(key)) {
          idByKey.set(key, row.id);
          if (row.rejectedAt) rejectedIds.add(row.id);
        }
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
        const ownKey = `${o.source}:${o.externalId}`;
        if (!known.has(ownKey) && sameOffer) {
          // Même annonce revenue sous un autre identifiant : on met à jour la ligne existante (identifiant conservé).
          return this.prisma.offer.update({
            where: { id: sameOffer },
            data: rejectedIds.has(sameOffer) ? { lastSeenAt: now } : data,
          });
        }
        if (!known.has(ownKey)) created++;
        return this.prisma.offer.upsert({
          where: { source_externalId: { source: o.source, externalId: o.externalId } },
          update: rejected.has(ownKey) ? { lastSeenAt: now } : data,
          create: { source: o.source, externalId: o.externalId, ...data },
        });
      }),
    );

    return { created, updated: unique.length - created };
  }
}
