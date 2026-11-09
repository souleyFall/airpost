import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC } from './public.decorator';
import type { ActiveSession, SessionService } from './session.service';

const SESSION: ActiveSession = {
  userId: 'u1',
  login: 'souleymane',
  csrfToken: 'csrf-secret-token',
};

function setup(options: { isPublic?: boolean; session?: ActiveSession | null } = {}) {
  const find = vi.fn().mockResolvedValue(options.session ?? null);
  const sessions = { find } as unknown as SessionService;
  const reflector = {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC ? options.isPublic : undefined),
  } as unknown as Reflector;
  const env = { NODE_ENV: 'development' } as Env;
  const guard = new AuthGuard(reflector, sessions, env);

  const context = (method: string, headers: Record<string, string> = {}) => {
    const request = { method, headers } as Record<string, unknown>;
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  };
  return { guard, find, context };
}

describe('AuthGuard', () => {
  it('laisse passer une route publique sans consulter les sessions', async () => {
    const { guard, find, context } = setup({ isPublic: true });

    await expect(guard.canActivate(context('GET').ctx)).resolves.toBe(true);
    expect(find).not.toHaveBeenCalled();
  });

  it('refuse (401) une requête sans cookie', async () => {
    const { guard, find, context } = setup();

    await expect(guard.canActivate(context('GET').ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(find).not.toHaveBeenCalled();
  });

  it('refuse (401) un cookie dont la session est inconnue ou expirée', async () => {
    const { guard, context } = setup({ session: null });

    await expect(
      guard.canActivate(context('GET', { cookie: 'airpost_session=inconnu' }).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepte une lecture avec une session valide et attache la session à la requête', async () => {
    const { guard, context } = setup({ session: SESSION });
    const { ctx, request } = context('GET', { cookie: 'airpost_session=ok' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.auth).toEqual(SESSION);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'exige le jeton CSRF pour %s (403 sans lui)',
    async (method) => {
      const { guard, context } = setup({ session: SESSION });

      await expect(
        guard.canActivate(context(method, { cookie: 'airpost_session=ok' }).ctx),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('refuse un mauvais jeton CSRF, de même longueur ou non', async () => {
    const { guard, context } = setup({ session: SESSION });

    for (const bad of ['csrf-secret-tokeX', 'court', '']) {
      await expect(
        guard.canActivate(
          context('POST', { cookie: 'airpost_session=ok', 'x-csrf-token': bad }).ctx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('accepte une requête qui modifie avec le bon jeton CSRF', async () => {
    const { guard, context } = setup({ session: SESSION });

    await expect(
      guard.canActivate(
        context('POST', { cookie: 'airpost_session=ok', 'x-csrf-token': SESSION.csrfToken }).ctx,
      ),
    ).resolves.toBe(true);
  });

  it('vérifie la session avant le jeton CSRF : un anonyme reçoit 401, pas 403', async () => {
    const { guard, context } = setup({ session: null });

    await expect(guard.canActivate(context('POST').ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
