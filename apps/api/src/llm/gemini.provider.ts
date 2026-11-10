import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { HTTP_FETCH, type HttpFetch } from '../http/http-fetch';
import { LlmError, LlmProvider, type LlmRequest, type LlmResponse } from './llm.types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;

/** Erreurs après lesquelles on essaie le modèle suivant : propres à ce modèle (quota, surcharge, modèle retiré). */
const SWITCHABLE = ['rate_limited', 'unavailable', 'model_unavailable'] as const;
type Switchable = (typeof SWITCHABLE)[number];
const isSwitchable = (reason: string): reason is Switchable =>
  (SWITCHABLE as readonly string[]).includes(reason);

/**
 * Durée pendant laquelle un modèle en échec n'est plus appelé (on ne le sollicite pas pour rien : chaque requête
 * refusée compte aussi dans le quota). Un quota atteint double à chaque échec consécutif (une limite par minute
 * passe vite, une limite par jour non) jusqu'à une heure ; un modèle retiré (404) est revu toutes les heures.
 */
const COOLDOWN_BASE_MS: Record<Switchable, number> = {
  rate_limited: 2 * 60_000,
  unavailable: 30_000,
  model_unavailable: 60 * 60_000,
};
const COOLDOWN_MAX_MS = 60 * 60_000;
/** Ordre de gravité quand tous les modèles ont échoué : ce que l'appelant doit comprendre en premier. */
const SEVERITY: Record<Switchable, number> = {
  rate_limited: 3,
  unavailable: 2,
  model_unavailable: 1,
};

interface Block {
  until: number;
  reason: Switchable;
  strikes: number;
}

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().nullish(),
        content: z
          .object({
            parts: z.array(
              z.object({ text: z.string().optional(), thought: z.boolean().optional() }),
            ),
          })
          .nullish(),
      }),
    )
    .nullish(),
  promptFeedback: z.object({ blockReason: z.string().nullish() }).nullish(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().nullish(),
      candidatesTokenCount: z.number().nullish(),
    })
    .nullish(),
});

const errorSchema = z.object({
  error: z
    .object({
      status: z.string().nullish(),
      details: z.array(z.object({ reason: z.string().nullish() })).nullish(),
    })
    .nullish(),
});

/**
 * Gemini (API REST de Google). La clé voyage dans l'en-tête `x-goog-api-key`, pas dans l'URL : elle ne
 * peut donc apparaître ni dans une trace d'erreur de réseau ni dans un journal d'accès.
 * Particularités vérifiées sur la vraie API : une clé invalide renvoie 400 (raison `API_KEY_INVALID`) et non 401 ;
 * un modèle retiré renvoie 404 ; une sortie coupée se signale par `finishReason: MAX_TOKENS`.
 */
@Injectable()
export class GeminiProvider extends LlmProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  /** Modèles mis de côté un moment, par nom. */
  private readonly blocked = new Map<string, Block>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
  ) {
    super();
  }

  /** Modèle principal puis modèles de secours, sans doublon. */
  private models(): string[] {
    return [...new Set([this.env.GEMINI_MODEL, ...(this.env.GEMINI_FALLBACK_MODELS ?? [])])];
  }

  /**
   * Essaie les modèles dans l'ordre : sur un quota atteint, une surcharge ou un modèle introuvable, le suivant prend
   * le relais. Les autres erreurs (clé refusée, demande bloquée, réponse inexploitable) valent pour tous les modèles
   * ou ne dépendent pas d'eux : elles sont renvoyées telles quelles, sans essayer les autres.
   */
  async generate(request: LlmRequest): Promise<LlmResponse> {
    const key = this.env.GEMINI_API_KEY;
    if (!key) {
      throw new LlmError('not_configured', 'Gemini : clé API absente (GEMINI_API_KEY).');
    }

    let worst: Switchable | undefined;
    const note = (reason: Switchable) => {
      if (worst === undefined || SEVERITY[reason] > SEVERITY[worst]) worst = reason;
    };
    const models = this.models();
    for (const [index, model] of models.entries()) {
      const block = this.blocked.get(model);
      if (block && block.until > Date.now()) {
        // Déjà en échec il y a peu : pas de requête inutile.
        note(block.reason);
        continue;
      }
      try {
        const response = await this.generateWith(model, key, request);
        this.blocked.delete(model);
        return { ...response, model };
      } catch (error) {
        if (!(error instanceof LlmError) || !isSwitchable(error.reason)) throw error;
        this.block(model, error.reason, block?.strikes ?? 0);
        note(error.reason);
        const next = models[index + 1];
        this.logger.warn(
          `Modèle ${model} : ${error.reason}${next ? `, bascule sur ${next}` : ', plus aucun modèle de secours'}.`,
        );
      }
    }
    const reason = worst ?? 'unavailable';
    throw new LlmError(
      reason,
      reason === 'rate_limited'
        ? 'Gemini : quota ou limite de débit atteint sur tous les modèles.'
        : reason === 'model_unavailable'
          ? 'Gemini : modèle indisponible (voir GEMINI_MODEL).'
          : 'Gemini : service indisponible sur tous les modèles.',
    );
  }

  private block(model: string, reason: Switchable, previousStrikes: number): void {
    const strikes = reason === 'rate_limited' ? previousStrikes + 1 : 0;
    const base = COOLDOWN_BASE_MS[reason];
    const duration = Math.min(COOLDOWN_MAX_MS, base * 2 ** Math.max(0, strikes - 1));
    this.blocked.set(model, { until: Date.now() + duration, reason, strikes });
  }

  private async generateWith(
    model: string,
    key: string,
    request: LlmRequest,
  ): Promise<LlmResponse> {
    let response: Response;
    try {
      response = await this.http(`${BASE_URL}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: {
            // Sortie JSON : le modèle ne peut pas entourer sa réponse de texte libre.
            responseMimeType: 'application/json',
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      // Pas de détail : le message d'origine peut contenir l'URL ou des morceaux du prompt.
      throw new LlmError('unavailable', 'Gemini : service injoignable.');
    }

    if (!response.ok) {
      throw await this.errorFor(response);
    }

    const body = responseSchema.safeParse(await response.json().catch(() => null));
    if (!body.success) {
      throw new LlmError('invalid_output', 'Gemini : réponse inattendue.');
    }
    if (body.data.promptFeedback?.blockReason) {
      throw new LlmError('blocked', 'Gemini : demande bloquée par les filtres du service.');
    }
    const candidate = body.data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
      // Un JSON coupé en plein milieu serait inexploitable : on le dit plutôt que de le parser.
      throw new LlmError('truncated', 'Gemini : réponse coupée (longueur maximale atteinte).');
    }
    if (
      candidate?.finishReason &&
      !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason)
    ) {
      throw new LlmError('blocked', 'Gemini : génération interrompue par le service.');
    }
    const text =
      candidate?.content?.parts
        // Les parties de « réflexion » du modèle ne font pas partie de la réponse.
        .filter((part) => !part.thought)
        .map((part) => part.text ?? '')
        .join('') ?? '';
    if (!text.trim()) {
      throw new LlmError('invalid_output', 'Gemini : réponse vide.');
    }
    return {
      text,
      usage: {
        promptTokens: body.data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  private async errorFor(response: Response): Promise<LlmError> {
    const { status } = response;
    if (status === 401 || status === 403) {
      return new LlmError('unauthorized', 'Gemini : accès refusé (clé ou droits).');
    }
    if (status === 429) {
      return new LlmError('rate_limited', 'Gemini : quota ou limite de débit atteint.');
    }
    if (status === 404) {
      return new LlmError('model_unavailable', 'Gemini : modèle indisponible (voir GEMINI_MODEL).');
    }
    if (status === 400) {
      // Une clé invalide arrive en 400 : on lit la raison structurée, jamais le message libre.
      const parsed = errorSchema.safeParse(await response.json().catch(() => null));
      const invalidKey = parsed.success
        ? parsed.data.error?.details?.some((detail) => detail.reason === 'API_KEY_INVALID')
        : false;
      return invalidKey
        ? new LlmError('unauthorized', 'Gemini : clé API invalide.')
        : new LlmError('invalid_output', 'Gemini : requête refusée (400).');
    }
    return new LlmError('unavailable', `Gemini : réponse ${status}.`);
  }
}
