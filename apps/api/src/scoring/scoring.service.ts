import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Profile } from '../profile/profile.schema';
import { type Position, scoreOffer } from './scoring';

/** Mises à jour envoyées par lots : une transaction de plusieurs centaines d'écritures reste raisonnable. */
const BATCH_SIZE = 200;

@Injectable()
export class ScoringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalcule le score de toutes les offres. Le score dépend du temps (fraîcheur) et du profil : on
   * recalcule tout à chaque collecte plutôt que de garder des scores périmés. Renvoie le nombre d'offres notées.
   */
  async rescoreAll(profile: Profile, home: Position, now = new Date()): Promise<number> {
    const offers = await this.prisma.offer.findMany({
      select: {
        id: true,
        source: true,
        title: true,
        description: true,
        latitude: true,
        longitude: true,
        applyUrl: true,
        contactEmail: true,
        channel: true,
        publishedAt: true,
        firstSeenAt: true,
      },
    });

    for (let i = 0; i < offers.length; i += BATCH_SIZE) {
      const batch = offers.slice(i, i + BATCH_SIZE);
      await this.prisma.$transaction(
        batch.map((offer) => {
          const detail = scoreOffer(offer, profile, home, now);
          return this.prisma.offer.update({
            where: { id: offer.id },
            data: { score: detail.total, scoreDetail: detail as unknown as Prisma.InputJsonObject },
          });
        }),
      );
    }
    return offers.length;
  }
}
