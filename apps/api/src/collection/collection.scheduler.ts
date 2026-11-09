import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionService } from './collection.service';

/** Première collecte une minute après le démarrage : l'API est prête et la base joignable. */
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * Collecte périodique (COLLECT_EVERY_HOURS, 0 = désactivée). Un simple minuteur plutôt qu'une bibliothèque
 * de planification : une seule tâche, un seul utilisateur. Les minuteurs ne retiennent pas le processus.
 */
@Injectable()
export class CollectionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CollectionScheduler.name);
  private first?: NodeJS.Timeout;
  private repeat?: NodeJS.Timeout;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly collection: CollectionService,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    const hours = this.env.COLLECT_EVERY_HOURS;
    if (hours <= 0) {
      return;
    }
    this.first = setTimeout(() => {
      void this.tick();
      this.repeat = setInterval(() => void this.tick(), hours * 60 * 60 * 1000);
      this.repeat.unref();
    }, FIRST_RUN_DELAY_MS);
    this.first.unref();
    this.logger.log(`Collecte automatique toutes les ${hours} h.`);
  }

  onModuleDestroy(): void {
    clearTimeout(this.first);
    clearInterval(this.repeat);
  }

  /** Une collecte automatique ne doit jamais faire tomber l'API : toute erreur est absorbée. */
  async tick(): Promise<void> {
    try {
      const user = await this.prisma.user.findFirst({ select: { id: true } });
      if (!user) {
        return;
      }
      await this.collection.run(user.id);
    } catch (error) {
      // Nature de l'erreur seulement : un message d'origine pourrait contenir une URL ou une clé.
      this.logger.warn(
        `Collecte automatique impossible : ${error instanceof Error ? error.name : 'erreur inconnue'}.`,
      );
    }
  }
}
