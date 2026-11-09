import type { Env } from '../config/env';

/**
 * Lecture des cookies d'une requête. On évite une dépendance de plus pour ces quelques lignes ;
 * le comportement (premier cookie du nom, valeur décodée, jamais d'exception) est couvert par les tests.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // Un pourcentage mal formé ne doit pas faire échouer la requête : cookie ignoré.
      return undefined;
    }
  }
  return undefined;
}

/** Le cookie est-il « Secure » ? Réglage explicite, sinon vrai en production. */
export function isSecureCookie(env: Pick<Env, 'NODE_ENV' | 'SESSION_COOKIE_SECURE'>): boolean {
  return env.SESSION_COOKIE_SECURE === undefined
    ? env.NODE_ENV === 'production'
    : env.SESSION_COOKIE_SECURE === 'true';
}

/**
 * Nom du cookie de session. En production le préfixe « __Host- » oblige le navigateur à refuser un cookie
 * qui ne serait pas Secure, sans domaine et à la racine : il ne peut pas être écrasé par un sous-domaine.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-airpost_session' : 'airpost_session';
}
