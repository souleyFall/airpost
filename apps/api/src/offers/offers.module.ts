import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { ProfileModule } from '../profile/profile.module';
import { OffersController } from './offers.controller';

@Module({ imports: [MatchingModule, ProfileModule], controllers: [OffersController] })
export class OffersModule {}
