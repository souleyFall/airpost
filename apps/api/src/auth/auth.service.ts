import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { SessionService, type NewSession } from './session.service';

@Injectable()
export class AuthService implements OnModuleInit {
  // Empreinte factice : sert à dépenser le même temps quand l'identifiant n'existe pas.
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  /** Calculée au démarrage : calculée à la première demande, elle rendrait celle-ci plus lente et donc repérable. */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwords.hash('mot de passe factice');
  }

  /**
   * Renvoie une session, ou null si l'identifiant ou le mot de passe est faux. Les deux cas sont
   * indiscernables, par le message comme par le temps de réponse (sinon on pourrait lister les identifiants).
   */
  async login(login: string, password: string): Promise<(NewSession & { login: string }) | null> {
    const user = await this.prisma.user.findUnique({ where: { login } });
    const valid = await this.passwords.verify(user?.passwordHash ?? this.dummyHash, password);
    if (!user || !valid) {
      return null;
    }
    return { ...(await this.sessions.create(user.id)), login: user.login };
  }
}
