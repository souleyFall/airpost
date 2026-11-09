import { z } from 'zod';

/** Une variable présente mais vide dans le fichier .env (`WEB_ORIGIN=`) vaut « absente ». */
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/**
 * Une origine web : schéma, hôte et port éventuel, sans chemin ni « / » final.
 * `URL.canParse` d'abord : Zod exécute aussi cette vérification sur une valeur qui n'est pas une URL,
 * et `new URL()` lèverait alors une erreur native qui embarque la valeur saisie (peut-être un secret).
 */
const origin = z.url().refine((value) => URL.canParse(value) && new URL(value).origin === value, {
  message: 'doit être une origine (schéma, hôte, port éventuel), sans chemin ni « / » final',
});

/**
 * Variables d'environnement connues de l'API.
 * Les valeurs par défaut sont les plus restrictives : écoute locale uniquement, CORS désactivé.
 * Toute variable absente de ce schéma (clés d'API, mots de passe...) est ignorée et n'est jamais
 * recopiée dans l'objet renvoyé.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Origine du front autorisée à appeler l'API depuis un navigateur. Absente : CORS désactivé. */
  WEB_ORIGIN: z.preprocess(emptyToUndefined, origin.optional()),
  /** Limitation de débit : au plus RATE_LIMIT_MAX requêtes par fenêtre et par adresse IP. */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/** Valide l'environnement. Échoue avec la liste des variables invalides, jamais avec leur valeur. */
export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  // Une variable mal saisie peut être un secret : on affiche son nom et le problème, pas sa valeur.
  const lines = result.error.issues.map(
    (issue) => `  - ${issue.path.join('.')} : ${issue.message}`,
  );
  throw new EnvError(`Configuration invalide :\n${lines.join('\n')}`);
}
