import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Accès à la base. Prisma 7 passe par un « adaptateur » : ici le pilote `pg` (pool de connexions).
 * La connexion s'ouvre à la première requête, pas au démarrage : l'API démarre même si la base tarde.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  /** Ferme proprement le pool à l'arrêt (SIGTERM de Docker, `app.close()` des tests). */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
