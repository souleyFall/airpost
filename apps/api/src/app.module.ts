import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

// Le module racine : il assemble les modules de l'application, un par fonctionnalité.
@Module({
  imports: [HealthModule],
})
export class AppModule {}
