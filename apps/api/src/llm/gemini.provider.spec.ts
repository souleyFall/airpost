import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import type { HttpFetch } from '../http/http-fetch';
import type { ApiHealthService } from '../api-health/api-health.service';
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
  const full = {
    GEMINI_API_KEY: KEY,
    GEMINI_MODEL: 'gemini-3.5-flash-lite',
    GEMINI_RETRY_DELAY_MS: 0,
    ...env,
  } as Env;
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

    expect(result).toEqual({
      text: '{"a":1}',
      usage: { promptTokens: 20, outputTokens: 18 },
      model: 'gemini-3.5-flash-lite',
    });
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

    expect(await provider.generate(REQUEST)).toMatchObject({
      text: '{"a":1}',
      usage: { promptTokens: 0, outputTokens: 0 },
    });
  });

  it('ignore les parties de réflexion du modèle (thought) : seul le JSON est renvoyé', async () => {
    const { provider } = setup(() =>
      json({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [{ text: 'Je réfléchis à la structure…', thought: true }, { text: '{"a":1}' }],
            },
          },
        ],
      }),
    );

    expect((await provider.generate(REQUEST)).text).toBe('{"a":1}');
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

describe('GeminiProvider : voyant de santé', () => {
  function withHealth(response: () => Response, env: Partial<Env> = {}) {
    const recorded: string[] = [];
    const health = {
      recordIfChanged: async (key: string, status: string) => {
        recorded.push(`${key}:${status}`);
      },
    } as unknown as ApiHealthService;
    const http = vi.fn<HttpFetch>(async () => response());
    const full = {
      GEMINI_API_KEY: KEY,
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      GEMINI_RETRY_DELAY_MS: 0,
      ...env,
    } as Env;
    return { provider: new GeminiProvider(full, http, health), recorded };
  }

  it('inscrit « OK » après un succès', async () => {
    const { provider, recorded } = withHealth(() => ok('{}'));

    await provider.generate(REQUEST);

    expect(recorded).toEqual(['GEMINI:OK']);
  });

  it.each([
    [429, 'QUOTA'],
    [503, 'DOWN'],
    [401, 'AUTH'],
  ])('inscrit l’état de la connexion après un %i : %s', async (status, expected) => {
    const { provider, recorded } = withHealth(() => json({}, status));

    await failure(provider);

    expect(recorded).toEqual([`GEMINI:${expected}`]);
  });

  it('ne dit rien d’une réponse inexploitable ou bloquée : la connexion, elle, fonctionne', async () => {
    const { provider, recorded } = withHealth(() => ok('{}', 'MAX_TOKENS'));

    await failure(provider);

    expect(recorded).toEqual([]);
  });

  it('fonctionne sans voyant (tests, ou module absent)', async () => {
    const { provider } = setup(() => ok('{}'));

    expect((await provider.generate(REQUEST)).text).toBe('{}');
  });
});

describe('GeminiProvider : modèles de secours', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const MODELS = { GEMINI_FALLBACK_MODELS: ['gemini-3.6-flash', 'gemini-3.8-flash'] };
  /** Réponse selon le modèle appelé (lu dans l'adresse) : un nombre = statut d'erreur, sinon succès. */
  function byModel(plan: Record<string, number | 'ok'>, env: Partial<Env> = MODELS) {
    const calls: string[] = [];
    const http = vi.fn<HttpFetch>(async (url) => {
      const model = /models\/([^:]+):/.exec(String(url))?.[1] ?? '';
      calls.push(model);
      const outcome = plan[model] ?? 'ok';
      return outcome === 'ok'
        ? ok(`{"par":"${model}"}`)
        : json({ error: { status: 'X' } }, outcome);
    });
    const full = {
      GEMINI_API_KEY: KEY,
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      GEMINI_RETRY_DELAY_MS: 0,
      ...env,
    } as Env;
    return { provider: new GeminiProvider(full, http), calls, plan };
  }

  it('sans erreur, seul le modèle principal est appelé', async () => {
    const { provider, calls } = byModel({});

    expect((await provider.generate(REQUEST)).model).toBe('gemini-3.5-flash-lite');
    expect(calls).toEqual(['gemini-3.5-flash-lite']);
  });

  it.each([
    [429, 'quota atteint', ['gemini-3.5-flash-lite', 'gemini-3.6-flash']],
    // Une surcharge est réessayée une fois sur le même modèle avant de basculer.
    [503, 'surcharge', ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash']],
    [404, 'modèle introuvable', ['gemini-3.5-flash-lite', 'gemini-3.6-flash']],
  ])('bascule sur le modèle suivant après un %i (%s)', async (status, _label, expectedCalls) => {
    const { provider, calls } = byModel({ 'gemini-3.5-flash-lite': status });

    const result = await provider.generate(REQUEST);

    expect(result.model).toBe('gemini-3.6-flash');
    expect(result.text).toBe('{"par":"gemini-3.6-flash"}');
    expect(calls).toEqual(expectedCalls);
  });

  it('enchaîne plusieurs modèles défaillants jusqu’au premier qui répond', async () => {
    const { provider, calls } = byModel({ 'gemini-3.5-flash-lite': 429, 'gemini-3.6-flash': 503 });

    expect((await provider.generate(REQUEST)).model).toBe('gemini-3.8-flash');
    // 3.6 (503) est réessayé une fois avant que 3.8 prenne le relais.
    expect(calls).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
    ]);
  });

  it('ne rappelle pas un modèle en échec pendant sa pause, puis le réessaie ensuite', async () => {
    const { provider, calls, plan } = byModel({ 'gemini-3.5-flash-lite': 429 });
    await provider.generate(REQUEST);
    calls.length = 0;

    await provider.generate(REQUEST);
    expect(calls).toEqual(['gemini-3.6-flash']);

    // Après la pause (2 min pour un premier quota atteint), le modèle principal est retenté.
    plan['gemini-3.5-flash-lite'] = 'ok';
    vi.setSystemTime(new Date('2026-11-10T08:02:01Z'));
    calls.length = 0;
    expect((await provider.generate(REQUEST)).model).toBe('gemini-3.5-flash-lite');
    expect(calls).toEqual(['gemini-3.5-flash-lite']);
  });

  it('allonge la pause d’un modèle qui reste bloqué (limite par jour), jusqu’à une heure', async () => {
    const { provider, calls } = byModel({ 'gemini-3.5-flash-lite': 429 });
    await provider.generate(REQUEST); // échec n°1 : pause de 2 min

    vi.setSystemTime(new Date('2026-11-10T08:02:01Z'));
    await provider.generate(REQUEST); // échec n°2 : pause de 4 min
    calls.length = 0;

    vi.setSystemTime(new Date('2026-11-10T08:05:00Z')); // 3 min plus tard : encore en pause
    await provider.generate(REQUEST);
    expect(calls).toEqual(['gemini-3.6-flash']);
  });

  it('tous les modèles en quota atteint : « quota atteint », que les appelants savent arrêter', async () => {
    const { provider } = byModel({
      'gemini-3.5-flash-lite': 429,
      'gemini-3.6-flash': 429,
      'gemini-3.8-flash': 429,
    });

    expect((await failure(provider)).reason).toBe('rate_limited');
  });

  it('un mélange de quota et de surcharge renvoie « quota atteint » (le plus grave)', async () => {
    const { provider } = byModel({
      'gemini-3.5-flash-lite': 503,
      'gemini-3.6-flash': 429,
      'gemini-3.8-flash': 503,
    });

    expect((await failure(provider)).reason).toBe('rate_limited');
  });

  it('tous les modèles en pause : aucune requête, erreur immédiate', async () => {
    const { provider, calls } = byModel(
      { 'gemini-3.5-flash-lite': 429 },
      { GEMINI_FALLBACK_MODELS: [] },
    );
    await failure(provider);
    calls.length = 0;

    expect((await failure(provider)).reason).toBe('rate_limited');
    expect(calls).toEqual([]);
  });

  it.each([
    [401, 'unauthorized'],
    [400, 'invalid_output'],
  ] as const)(
    'une erreur %i vaut pour tous les modèles : pas de bascule',
    async (status, reason) => {
      const { provider, calls } = byModel({ 'gemini-3.5-flash-lite': status });

      expect((await failure(provider)).reason).toBe(reason);
      expect(calls).toEqual(['gemini-3.5-flash-lite']);
    },
  );

  it('ne divulgue ni la clé ni le prompt quand tous les modèles échouent', async () => {
    const { provider } = byModel({
      'gemini-3.5-flash-lite': 429,
      'gemini-3.6-flash': 503,
      'gemini-3.8-flash': 404,
    });

    const { message } = await failure(provider);

    expect(message).not.toContain(KEY);
    expect(message).not.toContain('confidentiel');
  });
});

describe('GeminiProvider : surcharge passagère', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Réponses successives : un nombre = statut d'erreur, 'ok' = succès. La dernière se répète. */
  function sequence(steps: (number | 'ok' | 'timeout')[], env: Partial<Env> = {}) {
    let i = 0;
    const calls: string[] = [];
    const http = vi.fn<HttpFetch>(async (url) => {
      calls.push(/models\/([^:]+):/.exec(String(url))?.[1] ?? '');
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step === 'timeout') throw new Error('délai dépassé');
      return step === 'ok' ? ok('{"a":1}') : json({ error: { status: 'X' } }, step);
    });
    const full = {
      GEMINI_API_KEY: KEY,
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      GEMINI_FALLBACK_MODELS: ['gemini-3.6-flash'],
      GEMINI_RETRY_DELAY_MS: 1_000,
      ...env,
    } as Env;
    return { provider: new GeminiProvider(full, http), calls };
  }

  it('une surcharge qui passe en une seconde : même modèle, aucune bascule, aucune pause du modèle principal', async () => {
    const { provider, calls } = sequence([503, 'ok']);

    const pending = provider.generate(REQUEST);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result.model).toBe('gemini-3.5-flash-lite');
    expect(calls).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite']);

    // Le modèle principal n'a pas été mis en pause : la demande suivante le rappelle tout de suite.
    calls.length = 0;
    await provider.generate(REQUEST);
    expect(calls).toEqual(['gemini-3.5-flash-lite']);
  });

  it("attend la pause configurée avant le nouvel essai, pas plus d'un nouvel essai par modèle", async () => {
    const { provider, calls } = sequence([503]);

    const pending = provider.generate(REQUEST).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await pending;

    expect((error as LlmError).reason).toBe('unavailable');
    // Deux modèles × (un essai + un nouvel essai) : jamais une boucle.
    expect(calls).toHaveLength(4);
  });

  it("un délai dépassé n'est pas réessayé (il durerait aussi long) : on passe au modèle suivant", async () => {
    const { provider, calls } = sequence(['timeout', 'ok']);

    const result = await provider.generate(REQUEST);

    expect(result.model).toBe('gemini-3.6-flash');
    expect(calls).toEqual(['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
  });

  it("une erreur 4xx autre que quota n'est jamais réessayée", async () => {
    const { provider, calls } = sequence([400]);

    await provider.generate(REQUEST).catch(() => undefined);

    expect(calls).toEqual(['gemini-3.5-flash-lite']);
  });

  it('tous les modèles en pause pour simple indisponibilité : la demande suivante essaie quand même le principal', async () => {
    const { provider, calls } = sequence([503, 503, 503, 503, 'ok']);
    const first = provider.generate(REQUEST).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(calls).toHaveLength(4);
    calls.length = 0;

    // Pendant les 30 s de pause des deux modèles : avant la correction, l'erreur arrivait sans aucune requête.
    vi.setSystemTime(new Date('2026-11-10T08:00:05Z'));
    const result = await provider.generate(REQUEST);

    expect(result.model).toBe('gemini-3.5-flash-lite');
    expect(calls).toEqual(['gemini-3.5-flash-lite']);
  });

  it('tous les modèles en pause pour QUOTA : toujours aucune requête (on ne gaspille pas le quota)', async () => {
    const { provider, calls } = sequence([429]);
    await provider.generate(REQUEST).catch(() => undefined);
    calls.length = 0;

    await provider.generate(REQUEST).catch(() => undefined);

    expect(calls).toEqual([]);
  });
});
