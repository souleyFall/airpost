import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  // Le module Gmail (brouillons, suivi des réponses) fera évoluer les statuts.
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
