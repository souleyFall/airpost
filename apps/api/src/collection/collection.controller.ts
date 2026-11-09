import { Controller, Get, HttpCode, NotFoundException, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { CollectionService, type RunReport } from './collection.service';

// Pas de @Public() : session obligatoire ; POST exige aussi le jeton CSRF (garde global).
@Controller('collection')
export class CollectionController {
  constructor(private readonly collection: CollectionService) {}

  /** Lance une collecte maintenant. Limitée à 3 par minute : chaque collecte consomme les quotas des API. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('run')
  @HttpCode(200)
  run(@Req() req: AuthenticatedRequest): Promise<RunReport> {
    return this.collection.run(req.auth.userId);
  }

  /** Bilan de la dernière collecte (404 tant qu'aucune n'a eu lieu depuis le démarrage). */
  @Get('last')
  last(): RunReport {
    const report = this.collection.lastReport();
    if (!report) {
      throw new NotFoundException('Aucune collecte depuis le démarrage');
    }
    return report;
  }
}
