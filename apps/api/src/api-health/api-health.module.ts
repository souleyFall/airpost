import { Module } from '@nestjs/common';
import { ApiHealthController } from './api-health.controller';
import { ApiHealthService } from './api-health.service';

@Module({
  controllers: [ApiHealthController],
  providers: [ApiHealthService],
  // Exporté : la collecte et le fournisseur de modèle y inscrivent le résultat de leurs appels.
  exports: [ApiHealthService],
})
export class ApiHealthModule {}
