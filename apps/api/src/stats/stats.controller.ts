import { Controller, Get } from '@nestjs/common';
import type { Stats } from './stats';
import { StatsService } from './stats.service';

// Pas de @Public() : session obligatoire (garde global).
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  get(): Promise<Stats> {
    return this.stats.get();
  }
}
