import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { AuthenticatedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { isSecureCookie, readCookie, sessionCookieName } from './cookies';
import { Public } from './public.decorator';
import { SessionService } from './session.service';

// Bornes hautes : un mot de passe de 10 Mo ne doit pas faire travailler argon2 pour rien.
const loginSchema = z.object({
  login: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});
type LoginBody = z.infer<typeof loginSchema>;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get secure(): boolean {
    return isSecureCookie(this.env);
  }

  /** Limite stricte sur la connexion : 5 essais par minute et par adresse IP (contre la force brute). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // JSON uniquement : un formulaire HTML posté depuis un autre site ne peut pas ouvrir une session
    // à la place de l'utilisateur (« login CSRF »). Un navigateur ne peut pas envoyer ce type sans pré-vérification CORS.
    if (!req.is('application/json')) {
      throw new UnsupportedMediaTypeException('Le corps doit être du JSON');
    }
    const session = await this.auth.login(body.login, body.password);
    if (!session) {
      // Même réponse que l'identifiant soit inconnu ou le mot de passe faux.
      throw new UnauthorizedException('Identifiants invalides');
    }
    res.cookie(sessionCookieName(this.secure), session.token, {
      httpOnly: true, // illisible par JavaScript : une faille XSS ne peut pas voler la session
      secure: this.secure,
      sameSite: 'strict', // jamais envoyé depuis un autre site
      path: '/',
      expires: session.expiresAt,
    });
    return { login: session.login, csrfToken: session.csrfToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const name = sessionCookieName(this.secure);
    const token = readCookie(req.headers.cookie, name);
    if (token) {
      await this.sessions.destroy(token);
    }
    res.clearCookie(name, { httpOnly: true, secure: this.secure, sameSite: 'strict', path: '/' });
  }

  /** Permet à l'interface, après un rechargement de page, de retrouver l'utilisateur et le jeton CSRF. */
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { login: req.auth.login, csrfToken: req.auth.csrfToken };
  }
}
