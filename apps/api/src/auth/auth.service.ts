import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { SessionService, type NewSession } from './session.service';

@Injectable()
export class AuthService {
  // Empreinte factice, calculée une fois : sert à dépenser le même temps quand l'identifiant n'existe pas.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Renvoie une session, ou null si l'identifiant ou le mot de passe est faux. Les deux cas sont
   * indiscernables, par le message comme par le temps de réponse (sinon on pourrait lister les identifiants).
   */
  async login(login: string, password: string): Promise<(NewSession & { login: string }) | null> {
    const user = await this.prisma.user.findUnique({ where: { login } });
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await this.passwords.verify(hash, password);
    if (!user || !valid) {
      return null;
    }
    return { ...(await this.sessions.create(user.id)), login: user.login };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash('mot de passe factice');
    return this.dummyHash;
  }
}
