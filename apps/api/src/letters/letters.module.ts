import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { ProfileModule } from '../profile/profile.module';
import { LetterController } from './letter.controller';
import { LetterService } from './letter.service';

@Module({
  imports: [LlmModule, ProfileModule],
  controllers: [LetterController],
  providers: [LetterService],
  exports: [LetterService],
})
export class LettersModule {}
