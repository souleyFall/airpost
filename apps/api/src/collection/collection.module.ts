import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { MatchingModule } from '../matching/matching.module';
import { SourcesModule } from '../sources/sources.module';
import { CollectionController } from './collection.controller';
import { CollectionScheduler } from './collection.scheduler';
import { CollectionService } from './collection.service';

@Module({
  imports: [SourcesModule, ProfileModule, MatchingModule],
  controllers: [CollectionController],
  providers: [CollectionService, CollectionScheduler],
  exports: [CollectionService],
})
export class CollectionModule {}
