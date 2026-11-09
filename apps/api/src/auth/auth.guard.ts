import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { isSecureCookie, readCookie, sessionCookieName } from './cookies';
import { IS_PUBLIC } from './public.decorator';
import { type ActiveSession, SessionService } from './session.service';

/** Requête enrichie par le garde : la session de l'utilisateur connecté. */
export type AuthenticatedRequest = Request & { auth: ActiveSession };

/** Méthodes qui ne modifient rien : dispensées du jeton anti-CSRF. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameToken(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  // timingSafeEqual exige deux tampons de même longueur ; la longueur d'un jeton n'est pas secrète.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Garde global : toute route exige une session valide, sauf si elle est marquée @Public().
 * Pour les requêtes qui modifient des données, il exige aussi le jeton anti-CSRF de la session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName = sessionCookieName(isSecureCookie(this.env));
    const token = readCookie(request.headers.cookie, cookieName);
    const session = token ? await this.sessions.find(token) : null;
    if (!session) {
      throw new UnauthorizedException('Connexion requise');
    }

    if (
      !SAFE_METHODS.has(request.method) &&
      !sameToken(session.csrfToken, request.headers['x-csrf-token'])
    ) {
      throw new ForbiddenException('Jeton CSRF manquant ou invalide');
    }

    request.auth = session;
    return true;
  }
}
