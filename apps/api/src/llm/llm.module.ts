import { Module } from '@nestjs/common';
import { GeminiProvider } from './gemini.provider';
import { LlmService } from './llm.service';
import { LlmProvider } from './llm.types';

@Module({
  providers: [{ provide: LlmProvider, useClass: GeminiProvider }, LlmService],
  // La génération des lettres (PR suivante) utilisera LlmService.
  exports: [LlmService],
})
export class LlmModule {}
