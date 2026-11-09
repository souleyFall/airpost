import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { parseEnv } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Accès à la base. Prisma 7 passe par un « adaptateur » : ici le pilote `pg` (pool de connexions).
 * La connexion s'ouvre à la première requête, pas au démarrage : l'API démarre même si la base tarde.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const { DATABASE_URL } = parseEnv();
    super({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  }

  /** Ferme proprement le pool à l'arrêt (SIGTERM de Docker, `app.close()` des tests). */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
