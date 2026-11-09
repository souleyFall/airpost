import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { GmailClient } from './gmail.client';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';

@Module({
  imports: [ProfileModule],
  controllers: [GmailController],
  providers: [GmailClient, GmailService],
  exports: [GmailService],
})
export class GmailModule {}
