import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { ScoringModule } from '../scoring/scoring.module';
import { SourcesModule } from '../sources/sources.module';
import { CollectionController } from './collection.controller';
import { CollectionScheduler } from './collection.scheduler';
import { CollectionService } from './collection.service';
import { GeocoderService } from './geocoder.service';

@Module({
  imports: [SourcesModule, ProfileModule, ScoringModule],
  controllers: [CollectionController],
  providers: [CollectionService, CollectionScheduler, GeocoderService],
  exports: [CollectionService],
})
export class CollectionModule {}
