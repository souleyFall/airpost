import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { HTTP_FETCH, type HttpFetch } from '../http/http-fetch';

export type GmailFailure =
  'not_configured' | 'unauthorized' | 'rate_limited' | 'invalid' | 'unavailable';

export class GmailError extends Error {
  constructor(
    readonly reason: GmailFailure,
    message: string,
  ) {
    super(message);
    this.name = 'GmailError';
  }
}

export interface MessageMeta {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  receivedAt: Date;
}

export interface MessageContent {
  id: string;
  from: string;
  /** En-têtes « Authentication-Results » posés par Gmail à la réception (DKIM, SPF) : l'expéditeur affiché est falsifiable, eux non. */
  authenticationResults: string;
  receivedAt: Date;
  /** Corps `text/plain`, ou null si le message n'en a pas. */
  text: string | null;
}

/** Un corps de message plus long est tronqué : borne la mémoire et le travail de l'analyse. */
const MAX_BODY_CHARS = 500_000;
/** Profondeur maximale de l'arbre MIME explorée : un message malveillant ne doit pas faire boucler l'analyse. */
const MAX_MIME_DEPTH = 8;

interface Part {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: Part[];
}

const part: z.ZodType<Part> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(part).optional(),
  }),
);

/** Premier corps `text/plain` (encodé en base64url) de l'arbre MIME, ou null. */
function findText(node: Part, depth: number): string | null {
  if (depth > MAX_MIME_DEPTH) return null;
  if (node.mimeType === 'text/plain' && node.body?.data) {
    return node.body.data;
  }
  for (const child of node.parts ?? []) {
    const found = findText(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Fichier « utilisateur autorisé » produit par le consentement OAuth (client + jeton de renouvellement).
const tokenFile = z.object({
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  refresh_token: z.string().min(1),
});
// Fichier téléchargé depuis la console Google Cloud (application de bureau).
const credentialsFile = z.object({
  installed: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }),
});

interface Authorization {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Client minimal de l'API Gmail : jeton d'accès, création et suppression de brouillons, lecture.
 * Les fichiers d'autorisation sont lus à la demande ; aucun secret n'est journalisé ni inclus dans une erreur.
 * Étendues demandées lors du consentement : gmail.compose (brouillons) et gmail.readonly (réponses), rien d'autre :
 * en particulier jamais gmail.send, l'application ne peut donc pas envoyer de message.
 */
@Injectable()
export class GmailClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
  ) {}

  /** Les fichiers d'autorisation sont-ils présents et lisibles ? */
  isConfigured(): boolean {
    try {
      this.authorization();
      return true;
    } catch {
      return false;
    }
  }

  async createDraft(raw: string): Promise<string> {
    const response = await this.call('POST', '/drafts', { message: { raw } });
    const data: unknown = await response.json();
    const id = z.object({ id: z.string().min(1) }).safeParse(data);
    if (!id.success) {
      throw new GmailError('unavailable', 'Réponse Gmail inattendue.');
    }
    return id.data.id;
  }

  /** Supprime un brouillon. Déjà absent (404) = succès : le résultat voulu est atteint. */
  async deleteDraft(id: string): Promise<void> {
    await this.call('DELETE', `/drafts/${encodeURIComponent(id)}`, undefined, [404]);
  }

  /** Identifiants des messages qui correspondent à une recherche Gmail (jamais un balayage : requête obligatoire). */
  async searchMessageIds(query: string, max: number): Promise<string[]> {
    const params = new URLSearchParams({ q: query, maxResults: String(max) });
    const response = await this.call('GET', `/messages?${params.toString()}`);
    const data = z
      .object({ messages: z.array(z.object({ id: z.string().min(1) })).optional() })
      .safeParse(await response.json());
    if (!data.success) {
      throw new GmailError('unavailable', 'Réponse Gmail inattendue.');
    }
    return (data.data.messages ?? []).map((message) => message.id);
  }

  /** En-têtes utiles et extrait d'un message (pas le corps complet : minimisation). */
  async messageMeta(id: string): Promise<MessageMeta> {
    const params = new URLSearchParams({ format: 'metadata' });
    for (const header of ['Subject', 'From']) {
      params.append('metadataHeaders', header);
    }
    const response = await this.call(
      'GET',
      `/messages/${encodeURIComponent(id)}?${params.toString()}`,
    );
    const data = z
      .object({
        id: z.string().min(1),
        snippet: z.string().default(''),
        internalDate: z.string().regex(/^\d{1,16}$/),
        payload: z
          .object({
            headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
          })
          .default({ headers: [] }),
      })
      .safeParse(await response.json());
    if (!data.success) {
      throw new GmailError('unavailable', 'Réponse Gmail inattendue.');
    }
    const header = (name: string) =>
      data.data.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
      '';
    return {
      id: data.data.id,
      subject: header('Subject'),
      from: header('From'),
      snippet: data.data.snippet,
      receivedAt: new Date(Number(data.data.internalDate)),
    };
  }

  /**
   * Contenu d'un message : expéditeur, résultat d'authentification de Gmail et corps TEXTE. À n'utiliser que pour des
   * expéditeurs de confiance connus (alertes d'offres) : c'est la seule lecture d'un corps de message de l'application.
   * Le corps est analysé en mémoire par l'appelant et n'est jamais stocké ni journalisé.
   */
  async messageContent(id: string): Promise<MessageContent> {
    const response = await this.call('GET', `/messages/${encodeURIComponent(id)}?format=full`);
    const data = z
      .object({
        id: z.string().min(1),
        internalDate: z.string().regex(/^\d{1,16}$/),
        payload: part.default({}),
      })
      .safeParse(await response.json());
    if (!data.success) {
      throw new GmailError('unavailable', 'Réponse Gmail inattendue.');
    }
    const headers = data.data.payload.headers ?? [];
    const headerValues = (name: string) =>
      headers.filter((h) => h.name.toLowerCase() === name.toLowerCase()).map((h) => h.value);
    const encoded = findText(data.data.payload, 0);
    return {
      id: data.data.id,
      from: headerValues('From')[0] ?? '',
      authenticationResults: headerValues('Authentication-Results').join('\n'),
      receivedAt: new Date(Number(data.data.internalDate)),
      text:
        encoded === null
          ? null
          : Buffer.from(encoded, 'base64url').toString('utf8').slice(0, MAX_BODY_CHARS),
    };
  }

  /** Appel authentifié ; `tolerated` liste des statuts d'erreur acceptés (traités comme un succès). */
  async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    tolerated: number[] = [],
  ): Promise<Response> {
    const token = await this.token();
    let response: Response;
    try {
      response = await this.http(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GmailError('unavailable', 'Gmail injoignable.');
    }
    if (response.status === 401) {
      // Jeton d'accès refusé : on l'oublie pour en redemander un au prochain appel.
      this.accessToken = null;
    }
    if (!response.ok && !tolerated.includes(response.status)) {
      throw failure(response.status);
    }
    return response;
  }

  private authorization(): Authorization {
    const tokenPath = this.locate(this.env.GMAIL_TOKEN_FILE);
    if (!tokenPath) {
      throw new GmailError('not_configured', 'Gmail n’est pas configuré.');
    }
    const token = tokenFile.safeParse(readJson(tokenPath));
    if (!token.success) {
      throw new GmailError('not_configured', 'Fichier d’autorisation Gmail illisible.');
    }
    let { client_id: clientId, client_secret: clientSecret } = token.data;
    if (!clientId || !clientSecret) {
      const credentialsPath = this.locate(this.env.GMAIL_CREDENTIALS_FILE);
      const credentials = credentialsPath
        ? credentialsFile.safeParse(readJson(credentialsPath))
        : null;
      if (!credentials?.success) {
        throw new GmailError('not_configured', 'Identifiants Gmail introuvables.');
      }
      clientId = credentials.data.installed.client_id;
      clientSecret = credentials.data.installed.client_secret;
    }
    return { clientId, clientSecret, refreshToken: token.data.refresh_token };
  }

  private locate(file: string | undefined): string | null {
    if (!file) return null;
    const candidates = [resolve(process.cwd(), file), resolve(process.cwd(), '../..', file)];
    return candidates.find((path) => existsSync(path)) ?? null;
  }

  /** Jeton d'accès valide (renouvelé avec le jeton de renouvellement, gardé en mémoire jusqu'à son expiration). */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    const auth = this.authorization();
    let response: Response;
    try {
      response = await this.http(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: auth.clientId,
          client_secret: auth.clientSecret,
          refresh_token: auth.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GmailError('unavailable', 'Google injoignable.');
    }
    if (response.status === 400 || response.status === 401) {
      // « invalid_grant » : autorisation expirée ou révoquée (en mode Test, elle expire après 7 jours).
      throw new GmailError(
        'unauthorized',
        'Autorisation Gmail expirée ou révoquée : reconnecte Gmail.',
      );
    }
    if (!response.ok) {
      throw failure(response.status);
    }
    const data = z
      .object({ access_token: z.string().min(1), expires_in: z.number().positive() })
      .safeParse(await response.json());
    if (!data.success) {
      throw new GmailError('unavailable', 'Réponse Google inattendue.');
    }
    this.accessToken = {
      value: data.data.access_token,
      expiresAt: Date.now() + data.data.expires_in * 1000,
    };
    return this.accessToken.value;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\p{Cf}/u, ''));
  } catch {
    return null;
  }
}

/** Statut HTTP de Gmail -> erreur typée, sans corps de réponse (qui pourrait contenir des données). */
function failure(status: number): GmailError {
  if (status === 401 || status === 403) {
    return new GmailError('unauthorized', 'Gmail a refusé l’accès : reconnecte Gmail.');
  }
  if (status === 429) {
    return new GmailError('rate_limited', 'Quota Gmail atteint, réessaie plus tard.');
  }
  if (status === 400 || status === 422) {
    return new GmailError('invalid', `Gmail a refusé la requête (${status}).`);
  }
  return new GmailError('unavailable', `Gmail indisponible (${status}).`);
}
