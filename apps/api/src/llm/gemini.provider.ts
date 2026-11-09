import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { HTTP_FETCH, type HttpFetch } from '../sources/http-fetch';
import { LlmError, LlmProvider, type LlmRequest, type LlmResponse } from './llm.types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().nullish(),
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).nullish(),
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
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
  ) {
    super();
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const key = this.env.GEMINI_API_KEY;
    if (!key) {
      throw new LlmError('not_configured', 'Gemini : clé API absente (GEMINI_API_KEY).');
    }

    let response: Response;
    try {
      response = await this.http(`${BASE_URL}/${this.env.GEMINI_MODEL}:generateContent`, {
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
    const text = candidate?.content?.parts.map((part) => part.text ?? '').join('') ?? '';
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
