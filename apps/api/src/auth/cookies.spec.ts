import { describe, expect, it } from 'vitest';
import { isSecureCookie, readCookie, sessionCookieName } from './cookies';

describe('readCookie', () => {
  it('lit un cookie parmi plusieurs', () => {
    expect(readCookie('a=1; airpost_session=abc; b=2', 'airpost_session')).toBe('abc');
  });

  it('renvoie undefined sans en-tête ou sans le cookie demandé', () => {
    expect(readCookie(undefined, 'x')).toBeUndefined();
    expect(readCookie('a=1', 'x')).toBeUndefined();
  });

  it('ne confond pas un nom avec un autre qui le contient', () => {
    expect(readCookie('xairpost_session=pirate', 'airpost_session')).toBeUndefined();
    expect(readCookie('airpost_session_bis=pirate', 'airpost_session')).toBeUndefined();
  });

  it('garde le premier cookie quand le nom est répété', () => {
    expect(readCookie('s=premier; s=second', 's')).toBe('premier');
  });

  it('décode les pourcentages et supporte un « = » dans la valeur', () => {
    expect(readCookie('s=a%20b', 's')).toBe('a b');
    expect(readCookie('s=abc==', 's')).toBe('abc==');
  });

  it('ignore un cookie mal encodé au lieu de lever une exception', () => {
    expect(readCookie('s=%E0%A4%A', 's')).toBeUndefined();
  });
});

describe('isSecureCookie', () => {
  it('est vrai par défaut en production, faux ailleurs', () => {
    expect(isSecureCookie({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: undefined })).toBe(true);
    expect(isSecureCookie({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: undefined })).toBe(
      false,
    );
  });

  it('obéit au réglage explicite', () => {
    expect(isSecureCookie({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' })).toBe(false);
    expect(isSecureCookie({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'true' })).toBe(true);
  });
});

describe('sessionCookieName', () => {
  it('utilise le préfixe __Host- seulement quand le cookie est Secure', () => {
    expect(sessionCookieName(true)).toBe('__Host-airpost_session');
    expect(sessionCookieName(false)).toBe('airpost_session');
  });
});
