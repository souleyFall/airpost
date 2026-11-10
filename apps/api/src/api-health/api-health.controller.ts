import { Controller, Get } from '@nestjs/common';
import { type ApiHealthItem, ApiHealthService } from './api-health.service';

// Pas de @Public() : session obligatoire (garde global).
@Controller('api-health')
export class ApiHealthController {
  constructor(private readonly health: ApiHealthService) {}

  /** État de chaque connexion d'après son dernier appel (collecte ou modèle). */
  @Get()
  async list(): Promise<{ items: ApiHealthItem[] }> {
    return { items: await this.health.list() };
  }
}
