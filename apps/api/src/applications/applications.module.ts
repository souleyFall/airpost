import { Module } from '@nestjs/common';
import { GmailModule } from '../gmail/gmail.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [GmailModule], // suppression des brouillons Gmail liés
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  // Le module Gmail (brouillons, suivi des réponses) fera évoluer les statuts.
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
