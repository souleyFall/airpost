import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { type LetterResult, LetterService } from './letter.service';

// Session et jeton CSRF exigés par le garde global (POST).
@Controller('offers/:offerId/letter')
export class LetterController {
  constructor(private readonly letters: LetterService) {}

  /** Génère (ou régénère) la lettre d'une offre. Limité : chaque appel consomme le quota du modèle. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  generate(
    @Req() req: AuthenticatedRequest,
    @Param('offerId', new ParseUUIDPipe()) offerId: string,
  ): Promise<LetterResult> {
    return this.letters.generate(req.auth.userId, offerId);
  }
}
