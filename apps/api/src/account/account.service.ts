import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { GmailService } from '../gmail/gmail.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly gmail: GmailService,
  ) {}

  /**
   * Export de toutes les données de l'utilisateur (RGPD : accès et portabilité), en JSON.
   * Contient son profil, ses candidatures (lettres comprises), les offres liées et les réponses reçues.
   * Ne contient JAMAIS l'empreinte du mot de passe, les jetons de session ni le jeton CSRF.
   */
  async export(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        login: true,
        createdAt: true,
        profile: { select: { data: true, updatedAt: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('Compte introuvable');
    }
    const applications = await this.prisma.application.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        status: true,
        subject: true,
        body: true,
        validatedAt: true,
        appliedAt: true,
        createdAt: true,
        offer: {
          select: {
            source: true,
            title: true,
            company: true,
            city: true,
            applyUrl: true,
            contactEmail: true,
            publishedAt: true,
          },
        },
        replies: { select: { kind: true, receivedAt: true, snippet: true } },
      },
    });
    return {
      exportedAt: new Date().toISOString(),
      account: { login: user.login, createdAt: user.createdAt },
      profile: user.profile,
      applications,
    };
  }

  /**
   * Efface toutes les données (RGPD : effacement) : compte, profil, sessions, offres, candidatures et réponses.
   * Exige le mot de passe : une session volée ne suffit pas à tout détruire.
   */
  async erase(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) {
      throw new NotFoundException('Compte introuvable');
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new ForbiddenException('Mot de passe incorrect');
    }
    // Les brouillons Gmail contiennent les lettres : retirés d'abord, au mieux (Gmail injoignable n'empêche pas
    // l'effacement local, qui est la garantie principale ; l'utilisateur peut vider ses brouillons dans Gmail).
    const drafts = await this.prisma.application.findMany({
      where: { gmailDraftId: { not: null } },
      select: { gmailDraftId: true },
    });
    for (const { gmailDraftId } of drafts) {
      if (gmailDraftId) await this.gmail.deleteDraftQuietly(gmailDraftId);
    }
    // Les offres emportent leurs candidatures et leurs réponses (cascade) ; l'utilisateur, son profil et ses sessions.
    await this.prisma.$transaction([
      this.prisma.offer.deleteMany(),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
  }
}
