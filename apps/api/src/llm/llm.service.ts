import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { LlmError, LlmProvider } from './llm.types';

export interface GenerateObjectRequest<T> {
  system: string;
  user: string;
  /** La sortie du modèle doit satisfaire ce schéma, sinon elle est rejetée. */
  schema: ZodType<T>;
  temperature?: number;
  maxOutputTokens?: number;
  /** Faux : toujours interroger le modèle (par exemple pour « régénérer » et obtenir un autre texte). Vrai par défaut. */
  useCache?: boolean;
}

/** Durée de vie d'une réponse en mémoire : 6 heures. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Nombre maximal de réponses gardées en mémoire : au-delà, les plus anciennes sont oubliées. */
const CACHE_MAX_ENTRIES = 100;

const RETRY_NOTICE =
  '\n\nLa réponse précédente n’était pas conforme au format demandé. Réponds uniquement avec le JSON demandé.';

/**
 * Point d'entrée unique pour interroger un modèle : sortie JSON validée par un schéma (une nouvelle tentative
 * si elle ne l'est pas), mémoire des réponses identiques, une seule requête pour deux demandes identiques
 * simultanées. Ce service ne connaît aucun fournisseur : il passe par `LlmProvider`.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly provider: LlmProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<T> {
    const temperature = request.temperature ?? 0.3;
    if (request.useCache === false) {
      return this.generateAndValidate(request, temperature);
    }
    const maxOutputTokens = request.maxOutputTokens ?? 2_048;
    const key = this.cacheKey(request, temperature, maxOutputTokens);

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      // Copie : l'appelant peut modifier l'objet (y ajouter des coordonnées) sans fausser les réponses suivantes.
      return structuredClone(cached.value) as T;
    }
    // Deux demandes identiques en même temps : un seul appel (les quotas gratuits sont serrés).
    const pending = this.inFlight.get(key);
    if (pending) {
      return (pending as Promise<T>).then((value) => structuredClone(value));
    }

    const work = this.generateAndValidate(request, temperature)
      .then((value) => {
        this.remember(key, structuredClone(value));
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  private async generateAndValidate<T>(
    request: GenerateObjectRequest<T>,
    temperature: number,
  ): Promise<T> {
    const base = {
      system: request.system,
      temperature,
      maxOutputTokens: request.maxOutputTokens ?? 2_048,
    };

    for (const attempt of [0, 1]) {
      const response = await this.provider.generate({
        ...base,
        user: attempt === 0 ? request.user : request.user + RETRY_NOTICE,
      });
      // Des comptes seulement : jamais le prompt ni la réponse dans les journaux.
      this.logger.log(
        `Appel modèle${response.model ? ` ${response.model}` : ''} : ${response.usage.promptTokens} jetons envoyés, ${response.usage.outputTokens} reçus.`,
      );
      const value = this.parse(response.text, request.schema);
      if (value.ok) {
        return value.data;
      }
    }
    throw new LlmError(
      'invalid_output',
      'Le modèle n’a pas produit un JSON conforme au format attendu.',
    );
  }

  private parse<T>(text: string, schema: ZodType<T>): { ok: true; data: T } | { ok: false } {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false };
    }
    const result = schema.safeParse(json);
    return result.success ? { ok: true, data: result.data } : { ok: false };
  }

  /** Clé de mémoire : empreinte du modèle, des consignes, du contenu et de la température. */
  private cacheKey<T>(
    request: GenerateObjectRequest<T>,
    temperature: number,
    maxOutputTokens: number,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          this.env.GEMINI_MODEL,
          request.system,
          request.user,
          temperature,
          maxOutputTokens,
        ]),
      )
      .digest('hex');
  }

  private remember(key: string, value: unknown): void {
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
