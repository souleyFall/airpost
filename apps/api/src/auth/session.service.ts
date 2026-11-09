import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Durée de vie absolue d'une session : 7 jours, puis nouvelle connexion. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewSession {
  /** Jeton à placer dans le cookie. Jamais stocké en clair. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface ActiveSession {
  userId: string;
  login: string;
  csrfToken: string;
}

/** Empreinte du jeton : le jeton fait 256 bits aléatoires, un SHA-256 suffit (pas besoin d'argon2). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string): Promise<NewSession> {
    // Un jeton neuf à chaque connexion : pas de fixation de session.
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), csrfToken, expiresAt },
    });
    // Ménage au passage : les sessions expirées n'ont pas d'autre raison de rester.
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return { token, csrfToken, expiresAt };
  }

  /** Renvoie la session si le jeton existe et n'a pas expiré, sinon null. */
  async find(token: string): Promise<ActiveSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { login: true } } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return { userId: session.userId, login: session.user.login, csrfToken: session.csrfToken };
  }

  async destroy(token: string): Promise<void> {
    // deleteMany : pas d'erreur si la session n'existe déjà plus (double déconnexion).
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}
