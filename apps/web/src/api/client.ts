/**
 * Client HTTP de l'API. Deux règles de sécurité vivent ici et nulle part ailleurs :
 *  - le jeton anti-CSRF (renvoyé à la connexion) est gardé en mémoire, jamais dans localStorage, et
 *    ajouté à toute requête qui modifie des données ;
 *  - le corps est toujours du JSON : l'API refuse le reste, ce qui ferme les envois de formulaires
 *    déguisés venus d'un autre site.
 * Le cookie de session est HttpOnly : le code JavaScript ne le voit jamais.
 */
const BASE = '/api';

export interface ApiIssue {
  champ: string;
  probleme: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Version « démo » : vrai quand l'application est construite avec `vite build --mode demo`. La valeur est remplacée à
 * la construction : dans la version réelle, la condition est fausse et le code de la démo n'est pas inclus du tout.
 */
export const IS_DEMO = import.meta.env.MODE === 'demo';

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (IS_DEMO) {
    // Faux serveur en mémoire (données fictives) : aucune requête réseau, aucun appel d'API possible.
    const { demoApi } = await import('../demo/demoApi');
    return demoApi<T>(method, path, body);
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const { message, issues } = await errorDetails(response);
    throw new ApiError(response.status, message, issues);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * Message de l'API s'il est lisible, sinon un message neutre : jamais de contenu de réponse brut affiché.
 * Les erreurs de validation (400) listent le champ et le problème, jamais la valeur envoyée.
 */
async function errorDetails(response: Response): Promise<{ message: string; issues: ApiIssue[] }> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object') {
      const message =
        'message' in data && typeof data.message === 'string'
          ? data.message
          : `Erreur ${response.status}`;
      const issues: ApiIssue[] = [];
      if ('errors' in data && Array.isArray(data.errors)) {
        for (const item of data.errors as unknown[]) {
          if (item && typeof item === 'object' && 'champ' in item && 'probleme' in item) {
            issues.push({ champ: String(item.champ), probleme: String(item.probleme) });
          }
        }
      }
      return { message, issues };
    }
  } catch {
    // corps absent ou non JSON
  }
  return { message: `Erreur ${response.status}`, issues: [] };
}
