import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { GmailClient } from './gmail.client';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';
import { ReplySyncService } from './reply-sync.service';

@Module({
  imports: [ProfileModule],
  controllers: [GmailController],
  providers: [GmailClient, GmailService, ReplySyncService],
  // Le client est exporté pour la lecture des alertes d'offres (sources/alerts) : seul usage d'un corps de message.
  exports: [GmailService, GmailClient],
})
export class GmailModule {}
