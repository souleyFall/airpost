/** Fonction de requête HTTP injectée : les tests la remplacent, aucun appel réseau réel. */
export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

export const HTTP_FETCH = Symbol('HTTP_FETCH');
