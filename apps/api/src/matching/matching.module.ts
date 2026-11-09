import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { MatchService } from './match.service';

@Module({
  imports: [LlmModule],
  providers: [MatchService],
  exports: [MatchService],
})
export class MatchingModule {}
