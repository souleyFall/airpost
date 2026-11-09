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

/** Variable secrète facultative (clé d'API...) : absente ou vide = connecteur désactivé. */
const secret = () => z.preprocess(emptyToUndefined, z.string().min(1).max(512).optional());

/**
 * URL de connexion PostgreSQL. Elle contient le mot de passe : jamais recopiée dans un message d'erreur
 * (même précaution que pour l'origine, `URL.canParse` avant tout appel à `new URL()`).
 */
const databaseUrl = z
  .string()
  // Un seul contrôle : plusieurs `refine` s'exécutent tous, et le second appellerait `new URL()` sur une valeur invalide.
  .refine((value) => URL.canParse(value) && /^postgres(ql)?:$/.test(new URL(value).protocol), {
    message: 'doit être une URL commençant par postgresql://',
  });

/**
 * Variables d'environnement connues de l'API.
 * Les valeurs par défaut sont les plus restrictives : écoute locale uniquement, CORS désactivé.
 * Toute variable absente de ce schéma (clés d'API, mots de passe...) est ignorée et n'est jamais
 * recopiée dans l'objet renvoyé.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: databaseUrl,
    /** Collecte automatique des offres toutes les N heures (0 : désactivée, collecte à la demande seulement). */
    COLLECT_EVERY_HOURS: z.coerce.number().int().min(0).max(168).default(0),
    /** Durée de conservation des offres sans candidature (RGPD) : plus anciennes, elles sont supprimées. */
    OFFER_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(90),
    /**
     * Clé de l'API La Bonne Alternance. Facultative : sans elle, le connecteur est désactivé.
     * C'est un secret : jamais journalisée ni recopiée dans une erreur.
     */
    LBA_API_KEY: secret(),
    /** Clé de l'API Gemini. Secret : jamais journalisée, envoyée en en-tête (pas dans l'URL). Sans elle, la génération est désactivée. */
    GEMINI_API_KEY: secret(),
    /**
     * Modèle Gemini. Il entre dans le chemin de l'URL : seuls lettres minuscules, chiffres, points et tirets sont
     * acceptés, pour qu'une valeur fantaisiste ne puisse pas viser un autre chemin de l'API.
     */
    GEMINI_MODEL: z
      .preprocess(
        emptyToUndefined,
        z
          .string()
          .regex(/^[a-z0-9][a-z0-9.-]{1,60}$/)
          .optional(),
      )
      .default('gemini-3.5-flash-lite'),
    /** France Travail (La Bonne Boîte) : identifiant et secret OAuth2. Secrets, jamais journalisés. */
    FT_CLIENT_ID: secret(),
    FT_CLIENT_SECRET: secret(),
    /** Adzuna : identifiant et clé d'application. Secrets, jamais journalisés. */
    ADZUNA_APP_ID: secret(),
    ADZUNA_APP_KEY: secret(),
    /**
     * Fichiers d'autorisation Gmail (jamais leur contenu ici). Relatifs : cherchés dans le dossier courant puis à la
     * racine du dépôt. Absents : le module Gmail est désactivé (aucun brouillon, aucun suivi).
     */
    GMAIL_CREDENTIALS_FILE: z.preprocess(emptyToUndefined, z.string().max(300).optional()),
    GMAIL_TOKEN_FILE: z.preprocess(emptyToUndefined, z.string().max(300).optional()),
    /**
     * Cookie de session marqué « Secure » (envoyé seulement en HTTPS). Absent : vrai en production, faux sinon.
     * À mettre à « false » uniquement pour un usage local en http (docker compose sur ce poste).
     */
    SESSION_COOKIE_SECURE: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
    /** Origine du front autorisée à appeler l'API depuis un navigateur. Absente : CORS désactivé. */
    WEB_ORIGIN: z.preprocess(emptyToUndefined, origin.optional()),
    /**
     * Limitation de débit : au plus RATE_LIMIT_MAX requêtes par fenêtre et par adresse IP.
     * Des bornes hautes évitent qu'un zéro de trop ne désactive de fait la protection.
     */
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86_400_000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(100),
    /**
     * Nombre de proxys de confiance devant l'API (0 = aucun). Derrière le serveur web de l'application, mettre 1 :
     * sans cela toutes les requêtes semblent venir de l'adresse du proxy et la limitation de débit (donc la
     * protection contre la force brute) s'applique à tout le monde à la fois. Ne jamais mettre plus que le
     * nombre réel de proxys : l'en-tête X-Forwarded-For est alors falsifiable par l'appelant.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  })
  .superRefine((env, ctx) => {
    // CORS avec cookies de session : en production, l'origine du front doit être servie en HTTPS.
    if (env.NODE_ENV === 'production' && env.WEB_ORIGIN && !env.WEB_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'doit être en https:// en production',
      });
    }
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
