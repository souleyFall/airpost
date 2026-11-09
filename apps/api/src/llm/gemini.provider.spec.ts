import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import type { HttpFetch } from '../sources/http-fetch';
import { GeminiProvider } from './gemini.provider';
import { LlmError, type LlmRequest } from './llm.types';

const KEY = 'cle-gemini-secrete-12345';
const REQUEST: LlmRequest = {
  system: 'Consignes système',
  user: 'Contenu du prompt confidentiel',
  temperature: 0.2,
  maxOutputTokens: 500,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ok = (text: string, finishReason = 'STOP') =>
  json({
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 18 },
  });

function setup(response: () => Response | Promise<Response>, env: Partial<Env> = {}) {
  const http = vi.fn<HttpFetch>(async () => response());
  const full = { GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-3.5-flash-lite', ...env } as Env;
  return { provider: new GeminiProvider(full, http), http };
}

async function failure(provider: GeminiProvider): Promise<LlmError> {
  try {
    await provider.generate(REQUEST);
  } catch (error) {
    return error as LlmError;
  }
  throw new Error('une erreur était attendue');
}

describe('GeminiProvider', () => {
  it('envoie la requête au bon modèle, clé en en-tête, sortie JSON demandée', async () => {
    const { provider, http } = setup(() => ok('{"a":1}'));

    const result = await provider.generate(REQUEST);

    expect(result).toEqual({ text: '{"a":1}', usage: { promptTokens: 20, outputTokens: 18 } });
    const [url, init] = http.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(url).not.toContain(KEY);
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(init?.body as string) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction.parts[0]?.text).toBe('Consignes système');
    expect(body.contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Contenu du prompt confidentiel' }],
    });
    expect(body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 500,
    });
  });

  it('recolle les morceaux de texte et tolère l’absence de comptage de jetons', async () => {
    const { provider } = setup(() =>
      json({
        candidates: [
          { finishReason: 'STOP', content: { parts: [{ text: '{"a":' }, { text: '1}' }] } },
        ],
      }),
    );

    expect(await provider.generate(REQUEST)).toEqual({
      text: '{"a":1}',
      usage: { promptTokens: 0, outputTokens: 0 },
    });
  });

  it('refuse de s’appeler sans clé, sans réseau', async () => {
    const { provider, http } = setup(() => ok('{}'), { GEMINI_API_KEY: undefined });

    expect((await failure(provider)).reason).toBe('not_configured');
    expect(http).not.toHaveBeenCalled();
  });

  describe('erreurs', () => {
    it.each([
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [429, 'rate_limited'],
      [404, 'model_unavailable'],
      [500, 'unavailable'],
      [503, 'unavailable'],
    ] as const)('traduit le statut %i en « %s »', async (status, reason) => {
      const { provider } = setup(() => json({ error: { status: 'X' } }, status));

      expect((await failure(provider)).reason).toBe(reason);
    });

    it('reconnaît une clé invalide, renvoyée par Gemini en 400 avec la raison API_KEY_INVALID', async () => {
      const { provider } = setup(() =>
        json(
          { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } },
          400,
        ),
      );

      expect((await failure(provider)).reason).toBe('unauthorized');
    });

    it('classe tout autre 400 comme requête refusée, sans lire le message libre', async () => {
      const { provider } = setup(() =>
        json(
          { error: { status: 'INVALID_ARGUMENT', message: 'contient le prompt confidentiel' } },
          400,
        ),
      );

      const error = await failure(provider);

      expect(error.reason).toBe('invalid_output');
      expect(error.message).not.toContain('confidentiel');
    });

    it('signale une sortie coupée (MAX_TOKENS) plutôt que de renvoyer un JSON tronqué', async () => {
      const { provider } = setup(() => ok('{"poeme":"Dans le silence', 'MAX_TOKENS'));

      expect((await failure(provider)).reason).toBe('truncated');
    });

    it('signale une demande bloquée par les filtres, en entrée comme en sortie', async () => {
      const blockedInput = setup(() => json({ promptFeedback: { blockReason: 'SAFETY' } }));
      const blockedOutput = setup(() => ok('{}', 'SAFETY'));

      expect((await failure(blockedInput.provider)).reason).toBe('blocked');
      expect((await failure(blockedOutput.provider)).reason).toBe('blocked');
    });

    it('signale une réponse vide ou illisible', async () => {
      expect((await failure(setup(() => json({ candidates: [] })).provider)).reason).toBe(
        'invalid_output',
      );
      expect((await failure(setup(() => ok('   ')).provider)).reason).toBe('invalid_output');
      expect((await failure(setup(() => new Response('<html>')).provider)).reason).toBe(
        'invalid_output',
      );
    });

    it('ne laisse jamais la clé ni le prompt dans un message d’erreur, réseau coupé compris', async () => {
      const cases = [
        setup(() => json({}, 401)),
        setup(() => json({}, 429)),
        setup(() => json({}, 500)),
        setup(() => json({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }, 400)),
        setup(() => {
          throw new Error(`échec : ${KEY} ${REQUEST.user}`);
        }),
      ];
      for (const { provider } of cases) {
        const { message } = await failure(provider);
        expect(message).not.toContain(KEY);
        expect(message).not.toContain('confidentiel');
      }
    });
  });
});
