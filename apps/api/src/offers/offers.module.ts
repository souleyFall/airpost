import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { MatchingModule } from '../matching/matching.module';
import { ProfileModule } from '../profile/profile.module';
import { SourcesModule } from '../sources/sources.module';
import { ManualOfferController } from './manual-offer.controller';
import { ManualOfferService } from './manual-offer.service';
import { OffersController } from './offers.controller';

@Module({
  imports: [MatchingModule, ProfileModule, LlmModule, SourcesModule],
  // ManualOfferController d'abord : sa route « offers/manual » ne doit pas être prise pour un identifiant d'offre.
  controllers: [ManualOfferController, OffersController],
  providers: [ManualOfferService],
})
export class OffersModule {}
