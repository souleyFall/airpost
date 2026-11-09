import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Env } from '../config/env';
import { LlmService } from './llm.service';
import { LlmError, type LlmRequest, type LlmResponse } from './llm.types';

const schema = z.object({ objet: z.string().min(1), score: z.number().int().min(0).max(100) });
const VALID = JSON.stringify({ objet: 'Candidature', score: 80 });
const response = (text: string): LlmResponse => ({
  text,
  usage: { promptTokens: 10, outputTokens: 5 },
});

function setup(handler: (request: LlmRequest, call: number) => Promise<LlmResponse> | LlmResponse) {
  let calls = 0;
  const generate = vi.fn(async (request: LlmRequest) => handler(request, calls++));
  const service = new LlmService({ generate }, {
    GEMINI_MODEL: 'gemini-3.5-flash-lite',
  } as Env);
  return { service, generate };
}

const ask = (extra: Partial<Parameters<LlmService['generateObject']>[0]> = {}) => ({
  system: 'Consignes',
  user: 'Contenu',
  schema,
  ...extra,
});

describe('LlmService.generateObject', () => {
  it('renvoie l’objet validé par le schéma', async () => {
    const { service } = setup(() => response(VALID));

    expect(await service.generateObject(ask())).toEqual({ objet: 'Candidature', score: 80 });
  });

  it('transmet consignes, contenu, température et limite de sortie', async () => {
    const { service, generate } = setup(() => response(VALID));

    await service.generateObject(ask({ temperature: 0.7, maxOutputTokens: 900 }));

    expect(generate).toHaveBeenCalledWith({
      system: 'Consignes',
      user: 'Contenu',
      temperature: 0.7,
      maxOutputTokens: 900,
    });
  });

  it('retire les champs inconnus que le schéma ne décrit pas', async () => {
    const { service } = setup(() =>
      response(JSON.stringify({ objet: 'A', score: 1, secret: 'x' })),
    );

    expect(await service.generateObject(ask())).toEqual({ objet: 'A', score: 1 });
  });

  it('redemande une fois quand la sortie n’est pas conforme, avec un rappel du format', async () => {
    const { service, generate } = setup((_request, call) =>
      response(call === 0 ? '{"objet":"", "score": 500}' : VALID),
    );

    expect(await service.generateObject(ask())).toEqual({ objet: 'Candidature', score: 80 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]?.[0].user).toBe('Contenu');
    expect(generate.mock.calls[1]?.[0].user).toContain('Réponds uniquement avec le JSON demandé');
  });

  it('redemande aussi quand la sortie n’est pas du JSON', async () => {
    const { service, generate } = setup((_r, call) =>
      response(call === 0 ? 'Voici ma réponse : …' : VALID),
    );

    await service.generateObject(ask());

    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('abandonne après deux sorties non conformes, sans recopier le contenu dans le message', async () => {
    const { service, generate } = setup(() => response('{"contenu":"SECRET-GENERE"}'));

    const error = await service.generateObject(ask()).catch((e: unknown) => e as LlmError);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).reason).toBe('invalid_output');
    expect((error as LlmError).message).not.toContain('SECRET-GENERE');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('ne redemande pas pour une erreur du fournisseur (quota, clé...)', async () => {
    const { service, generate } = setup(() => {
      throw new LlmError('rate_limited', 'quota');
    });

    await expect(service.generateObject(ask())).rejects.toMatchObject({ reason: 'rate_limited' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  describe('mémoire des réponses', () => {
    it('ne rappelle pas le modèle pour une demande identique', async () => {
      const { service, generate } = setup(() => response(VALID));

      await service.generateObject(ask());
      await service.generateObject(ask());

      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('renvoie une copie : modifier le résultat ne fausse pas les réponses suivantes', async () => {
      const { service } = setup(() => response(VALID));
      const first = (await service.generateObject(ask())) as z.infer<typeof schema>;
      first.objet = 'MODIFIÉ PAR L’APPELANT';

      const second = (await service.generateObject(ask())) as z.infer<typeof schema>;

      expect(second.objet).toBe('Candidature');
    });

    it('rappelle le modèle quand la limite de sortie change', async () => {
      const { service, generate } = setup(() => response(VALID));

      await service.generateObject(ask({ maxOutputTokens: 200 }));
      await service.generateObject(ask({ maxOutputTokens: 2000 }));

      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('rappelle le modèle quand le contenu, les consignes ou la température changent', async () => {
      const { service, generate } = setup(() => response(VALID));

      await service.generateObject(ask());
      await service.generateObject(ask({ user: 'Autre contenu' }));
      await service.generateObject(ask({ system: 'Autres consignes' }));
      await service.generateObject(ask({ temperature: 0.9 }));

      expect(generate).toHaveBeenCalledTimes(4);
    });

    it('ne garde pas un échec en mémoire', async () => {
      const { service, generate } = setup((_r, call) => {
        if (call === 0) throw new LlmError('unavailable', 'panne');
        return response(VALID);
      });

      await expect(service.generateObject(ask())).rejects.toBeInstanceOf(LlmError);
      await expect(service.generateObject(ask())).resolves.toBeDefined();
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('expire après 6 heures', async () => {
      vi.useFakeTimers();
      try {
        const { service, generate } = setup(() => response(VALID));
        await service.generateObject(ask());

        vi.advanceTimersByTime(5 * 60 * 60 * 1000);
        await service.generateObject(ask());
        expect(generate).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(2 * 60 * 60 * 1000);
        await service.generateObject(ask());
        expect(generate).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('oublie les plus anciennes réponses au-delà de 100 entrées', async () => {
      const { service, generate } = setup(() => response(VALID));

      for (let i = 0; i < 101; i++) await service.generateObject(ask({ user: `demande ${i}` }));
      await service.generateObject(ask({ user: 'demande 100' })); // récente : en mémoire
      await service.generateObject(ask({ user: 'demande 0' })); // la plus ancienne : oubliée

      expect(generate).toHaveBeenCalledTimes(102);
    });

    it('regroupe deux demandes identiques simultanées en un seul appel', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { service, generate } = setup(async () => {
        await gate;
        return response(VALID);
      });

      const first = service.generateObject(ask());
      const second = service.generateObject(ask());
      release();

      expect(await first).toEqual(await second);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('partage l’échec entre demandes simultanées sans bloquer la suivante', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { service, generate } = setup(async (_r, call) => {
        if (call === 0) {
          await gate;
          throw new LlmError('unavailable', 'panne');
        }
        return response(VALID);
      });

      const results = Promise.allSettled([
        service.generateObject(ask()),
        service.generateObject(ask()),
      ]);
      release();
      expect((await results).map((r) => r.status)).toEqual(['rejected', 'rejected']);
      await expect(service.generateObject(ask())).resolves.toBeDefined();
      expect(generate).toHaveBeenCalledTimes(2);
    });
  });
});
