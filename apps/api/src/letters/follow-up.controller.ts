import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { type FollowUpResult, LetterService } from './letter.service';

// Session et jeton CSRF exigés par le garde global (POST).
@Controller('applications/:id/follow-up')
export class FollowUpController {
  constructor(private readonly letters: LetterService) {}

  /** Rédige (ou rédige à nouveau) la relance d'une candidature. Limité : chaque appel consomme le quota du modèle. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  generate(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<FollowUpResult> {
    return this.letters.generateFollowUp(req.auth.userId, id);
  }
}
