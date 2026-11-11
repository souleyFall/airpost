import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env';

// Une configuration valide minimale : la base est obligatoire, les tests ajoutent ou remplacent le reste.
const DATABASE_URL = 'postgresql://airpost:motdepasse@localhost:5432/airpost';
const parse = (raw: NodeJS.ProcessEnv = {}) => parseEnv({ DATABASE_URL, ...raw });

describe('parseEnv', () => {
  it('applique des valeurs par défaut sûres : écoute locale, CORS désactivé', () => {
    const env = parse({});

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      API_PORT: 3000,
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_MAX: 100,
    });
    expect(env.WEB_ORIGIN).toBeUndefined();
  });

  it('convertit le port en nombre', () => {
    expect(parse({ API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it.each(['abc', '0', '70000', '3000.5'])('refuse le port invalide « %s »', (port) => {
    expect(() => parse({ API_PORT: port })).toThrow(EnvError);
    expect(() => parse({ API_PORT: port })).toThrow(/API_PORT/);
  });

  it("n'affiche jamais la valeur reçue dans le message d'erreur", () => {
    const secret = 'valeur-secrete-123456';
    let message = '';
    try {
      parse({ API_PORT: secret });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('API_PORT');
    expect(message).not.toContain(secret);
  });

  it('refuse un NODE_ENV inconnu', () => {
    expect(() => parse({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('accepte une origine web', () => {
    expect(parse({ WEB_ORIGIN: 'https://airpost.example' }).WEB_ORIGIN).toBe(
      'https://airpost.example',
    );
  });

  it.each(['https://airpost.example/', 'https://airpost.example/app', 'pas une url'])(
    'refuse WEB_ORIGIN « %s » (ce n’est pas une origine)',
    (value) => {
      // EnvError et non TypeError : l'erreur native de `new URL()` embarquerait la valeur saisie.
      expect(() => parse({ WEB_ORIGIN: value })).toThrow(EnvError);
      expect(() => parse({ WEB_ORIGIN: value })).toThrow(/WEB_ORIGIN/);
    },
  );

  it("ne laisse fuiter aucune valeur saisie, même quand ce n'est pas une URL", () => {
    const secret = 'sk-secret-valeur-123456';
    let error: unknown;
    try {
      parse({ WEB_ORIGIN: secret });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EnvError);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(secret);
  });

  it('exige https pour WEB_ORIGIN en production (cookies de session)', () => {
    expect(() => parse({ NODE_ENV: 'production', WEB_ORIGIN: 'http://airpost.example' })).toThrow(
      /WEB_ORIGIN : doit être en https/,
    );
    expect(
      parse({ NODE_ENV: 'production', WEB_ORIGIN: 'https://airpost.example' }).WEB_ORIGIN,
    ).toBe('https://airpost.example');
    // En développement, le front local est en http.
    expect(parse({ NODE_ENV: 'development', WEB_ORIGIN: 'http://localhost:5173' }).WEB_ORIGIN).toBe(
      'http://localhost:5173',
    );
  });

  it.each([
    ['RATE_LIMIT_MAX', '10001'],
    ['RATE_LIMIT_WINDOW_MS', '86400001'],
  ])('plafonne %s pour qu’un zéro de trop ne désactive pas la limitation', (name, value) => {
    expect(() => parse({ [name]: value })).toThrow(new RegExp(name));
  });

  it('traite une WEB_ORIGIN vide comme absente', () => {
    expect(parse({ WEB_ORIGIN: '' }).WEB_ORIGIN).toBeUndefined();
  });

  it.each([
    ['true', 'true'],
    ['false', 'false'],
    ['', undefined],
  ])('lit SESSION_COOKIE_SECURE=« %s »', (value, expected) => {
    expect(parse({ SESSION_COOKIE_SECURE: value }).SESSION_COOKIE_SECURE).toBe(expected);
  });

  it('refuse une valeur ambiguë pour SESSION_COOKIE_SECURE', () => {
    expect(() => parse({ SESSION_COOKIE_SECURE: 'oui' })).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it('lit les clés des sources comme facultatives : absentes ou vides, elles valent undefined', () => {
    const env = parse({ LBA_API_KEY: '', FT_CLIENT_ID: 'id', ADZUNA_APP_KEY: '' });

    expect(env.LBA_API_KEY).toBeUndefined();
    expect(env.FT_CLIENT_ID).toBe('id');
    expect(env.FT_CLIENT_SECRET).toBeUndefined();
    expect(env.ADZUNA_APP_KEY).toBeUndefined();
  });

  it('lit le modèle Gemini : défaut gemini-3.5-flash-lite, valeur vide = défaut', () => {
    expect(parse().GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(parse({ GEMINI_MODEL: '' }).GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(parse({ GEMINI_MODEL: 'gemini-3.5-flash' }).GEMINI_MODEL).toBe('gemini-3.5-flash');
    expect(parse().GEMINI_RETRY_DELAY_MS).toBe(1000);
    expect(parse({ GEMINI_RETRY_DELAY_MS: '0' }).GEMINI_RETRY_DELAY_MS).toBe(0);
    expect(() => parse({ GEMINI_RETRY_DELAY_MS: '-1' })).toThrow(/GEMINI_RETRY_DELAY_MS/);
    expect(parse().GEMINI_FALLBACK_MODELS).toEqual([]);
    expect(parse({ GEMINI_FALLBACK_MODELS: '' }).GEMINI_FALLBACK_MODELS).toEqual([]);
    expect(
      parse({ GEMINI_FALLBACK_MODELS: ' gemini-3.6-flash , gemini-3.8-flash ' })
        .GEMINI_FALLBACK_MODELS,
    ).toEqual(['gemini-3.6-flash', 'gemini-3.8-flash']);
    expect(() => parse({ GEMINI_FALLBACK_MODELS: 'a-b/../c' })).toThrow(/GEMINI_FALLBACK_MODELS/);
    expect(() => parse({ GEMINI_FALLBACK_MODELS: 'aa,bb,cc,dd' })).toThrow(
      /GEMINI_FALLBACK_MODELS/,
    );
  });

  it.each(['../autre', 'modele avec espace', 'Gemini', 'm?x=1', 'a/b', 'x:generate'])(
    'refuse le modèle « %s » : il entre dans le chemin de l’URL',
    (value) => {
      expect(() => parse({ GEMINI_MODEL: value })).toThrow(/GEMINI_MODEL/);
    },
  );

  it('exige DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it.each(['pas une url', 'mysql://u:p@h/db', 'http://exemple.test'])(
    'refuse DATABASE_URL « %s » sans jamais la recopier',
    (value) => {
      let message = '';
      try {
        parseEnv({ DATABASE_URL: value });
      } catch (error) {
        expect(error).toBeInstanceOf(EnvError);
        message = (error as Error).message;
      }

      expect(message).toMatch(/DATABASE_URL/);
      expect(message).not.toContain(value);
    },
  );

  it("n'affiche jamais le mot de passe d'une URL de base invalide", () => {
    let message = '';
    try {
      parseEnv({ DATABASE_URL: 'mysql://admin:mot-de-passe-secret@h/db' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain('mot-de-passe-secret');
  });

  it("ignore les variables inconnues et ne les recopie jamais (clés d'API...)", () => {
    const env = parse({ OPENAI_API_KEY: 'secret', POSTGRES_PASSWORD: 'secret-db' });

    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('POSTGRES_PASSWORD');
  });
});
