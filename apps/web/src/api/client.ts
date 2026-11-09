/**
 * Client HTTP de l'API. Deux règles de sécurité vivent ici et nulle part ailleurs :
 *  - le jeton anti-CSRF (renvoyé à la connexion) est gardé en mémoire, jamais dans localStorage, et
 *    ajouté à toute requête qui modifie des données ;
 *  - le corps est toujours du JSON : l'API refuse le reste, ce qui ferme les envois de formulaires
 *    déguisés venus d'un autre site.
 * Le cookie de session est HttpOnly : le code JavaScript ne le voit jamais.
 */
const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
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
    throw new ApiError(response.status, await errorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Message de l'API s'il est lisible, sinon un message neutre : jamais de contenu de réponse brut affiché. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }
  } catch {
    // corps absent ou non JSON
  }
  return `Erreur ${response.status}`;
}
