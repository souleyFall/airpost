import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { type DraftResult, GmailService } from './gmail.service';

// Session obligatoire ; POST exige aussi le jeton CSRF (garde global).
@Controller()
export class GmailController {
  constructor(private readonly gmail: GmailService) {}

  /** Gmail est-il configuré ? (jamais le contenu des fichiers d'autorisation). */
  @Get('gmail/status')
  status() {
    return this.gmail.status();
  }

  /** Crée le brouillon Gmail d'une candidature validée. Limité : chaque appel utilise le quota Gmail. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('applications/:id/draft')
  @HttpCode(200)
  createDraft(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DraftResult> {
    return this.gmail.createDraft(req.auth.userId, id);
  }
}
