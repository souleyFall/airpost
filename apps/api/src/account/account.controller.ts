import { Body, Controller, Get, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { isSecureCookie, sessionCookieName } from '../auth/cookies';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AccountService } from './account.service';

const eraseBody = z.strictObject({ password: z.string().min(1).max(256) });
type EraseBody = z.infer<typeof eraseBody>;

// Session obligatoire (garde global) ; l'effacement exige en plus le jeton CSRF et le mot de passe.
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Toutes mes données, en JSON. Limité : l'export est volumineux. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="airpost-export.json"')
  @Header('Cache-Control', 'no-store')
  export(@Req() req: AuthenticatedRequest) {
    return this.account.export(req.auth.userId);
  }

  /** Efface tout. Irréversible. Mot de passe exigé ; 3 essais par minute (contre l'essai de mots de passe). */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('erase')
  @HttpCode(204)
  async erase(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(eraseBody)) body: EraseBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.account.erase(req.auth.userId, body.password);
    const secure = isSecureCookie(this.env);
    res.clearCookie(sessionCookieName(secure), {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
    });
  }
}
