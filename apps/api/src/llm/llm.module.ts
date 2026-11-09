import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module';
import { GeminiProvider } from './gemini.provider';
import { LlmService } from './llm.service';
import { LlmProvider } from './llm.types';

@Module({
  // SourcesModule exporte la fonction de requête HTTP injectable (remplacée par un faux dans les tests).
  imports: [SourcesModule],
  providers: [{ provide: LlmProvider, useClass: GeminiProvider }, LlmService],
  // La génération des lettres (PR suivante) utilisera LlmService.
  exports: [LlmService],
})
export class LlmModule {}
