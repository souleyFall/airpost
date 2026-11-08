import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// Un module regroupe ce qui va ensemble : ses routes (controllers) et sa logique (providers).
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
