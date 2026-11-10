import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type Stats, computeStats } from './stats';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Chiffres du tableau de bord : lecture seule, aucun texte de lettre ni de mail, seulement des compteurs. */
  async get(now = new Date()): Promise<Stats> {
    const [applications, offers] = await Promise.all([
      this.prisma.application.findMany({
        select: {
          status: true,
          appliedAt: true,
          followedUpAt: true,
          offer: { select: { source: true } },
          replies: { select: { kind: true, receivedAt: true } },
        },
      }),
      this.prisma.offer.findMany({ select: { source: true, firstSeenAt: true } }),
    ]);
    return computeStats(
      applications.map(({ offer, ...application }) => ({ ...application, source: offer.source })),
      offers,
      now,
    );
  }
}
