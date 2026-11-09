import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReplyKind } from '../generated/prisma/enums';
import { type DraftResult, GmailService } from './gmail.service';
import { ReplySyncService, type SyncReport } from './reply-sync.service';

const kindBody = z.strictObject({
  kind: z.enum(Object.values(ReplyKind) as [ReplyKind, ...ReplyKind[]]),
});
type KindBody = z.infer<typeof kindBody>;

// Session obligatoire ; POST et PATCH exigent aussi le jeton CSRF (garde global).
@Controller()
export class GmailController {
  constructor(
    private readonly gmail: GmailService,
    private readonly replies: ReplySyncService,
  ) {}

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

  /** Cherche les réponses aux candidatures envoyées. Limité : 3 par minute. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('gmail/sync')
  @HttpCode(200)
  sync(): Promise<SyncReport> {
    return this.replies.sync();
  }

  /** Bilan de la dernière synchronisation (404 tant qu'aucune n'a eu lieu depuis le démarrage). */
  @Get('gmail/sync')
  lastSync(): SyncReport {
    const report = this.replies.lastReport();
    if (!report) {
      throw new NotFoundException('Aucune synchronisation depuis le démarrage');
    }
    return report;
  }

  /** Corrige la catégorie d'un message : le statut de la candidature suit. */
  @Patch('replies/:id')
  correct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(kindBody)) body: KindBody,
  ) {
    return this.replies.correct(id, body.kind);
  }
}
