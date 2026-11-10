import { Module } from '@nestjs/common';
import { ApiHealthModule } from '../api-health/api-health.module';
import { ProfileModule } from '../profile/profile.module';
import { MatchingModule } from '../matching/matching.module';
import { SourcesModule } from '../sources/sources.module';
import { CollectionController } from './collection.controller';
import { CollectionScheduler } from './collection.scheduler';
import { CollectionService } from './collection.service';

@Module({
  imports: [SourcesModule, ProfileModule, MatchingModule, ApiHealthModule],
  controllers: [CollectionController],
  providers: [CollectionService, CollectionScheduler],
  exports: [CollectionService],
})
export class CollectionModule {}
