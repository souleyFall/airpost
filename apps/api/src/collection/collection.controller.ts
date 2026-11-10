import { Controller, Get, HttpCode, Inject, NotFoundException, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IndeedAlertsConnector } from '../sources/alerts/indeed-alerts.connector';
import { CollectionService, type RunReport } from './collection.service';

// Pas de @Public() : session obligatoire ; POST exige aussi le jeton CSRF (garde global).
@Controller('collection')
export class CollectionController {
  constructor(
    private readonly collection: CollectionService,
    @Inject(ENV) private readonly env: Env,
    private readonly indeedAlerts: IndeedAlertsConnector,
  ) {}

  /** Lance une collecte maintenant. Limitée à 3 par minute : chaque collecte consomme les quotas des API. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('run')
  @HttpCode(200)
  run(@Req() req: AuthenticatedRequest): Promise<RunReport> {
    return this.collection.run(req.auth.userId);
  }

  /**
   * Quelles connexions sont configurées (clé présente ou non) : jamais la valeur des clés.
   * L'écran « Sources » s'en sert pour distinguer « pas configurée » de « en panne ».
   */
  @Get('status')
  status() {
    const configured = (value: string | undefined) => Boolean(value && value.length > 0);
    return {
      sources: {
        LBA: configured(this.env.LBA_API_KEY),
        LBB: configured(this.env.FT_CLIENT_ID) && configured(this.env.FT_CLIENT_SECRET),
        ADZUNA: configured(this.env.ADZUNA_APP_ID) && configured(this.env.ADZUNA_APP_KEY),
        GOOGLE_JOBS: configured(this.env.SERPAPI_KEY),
        GLASSDOOR: configured(this.env.SERPAPI_KEY),
        // Alertes Indeed : lues dans Gmail, donc configurées si l'autorisation Gmail l'est (aucune clé propre).
        INDEED: this.indeedAlerts.isConfigured(),
      },
      gemini: { configured: configured(this.env.GEMINI_API_KEY), model: this.env.GEMINI_MODEL },
    };
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
