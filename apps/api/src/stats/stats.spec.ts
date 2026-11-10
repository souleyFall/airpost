import { describe, expect, it } from 'vitest';
import { type StatsApplication, computeStats } from './stats';

// Mercredi 11 novembre 2026 : la semaine en cours commence le lundi 9.
const NOW = new Date('2026-11-11T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const app = (extra: Partial<StatsApplication> = {}): StatsApplication => ({
  status: 'APPLIED',
  appliedAt: daysAgo(3),
  followedUpAt: null,
  source: 'LBA',
  replies: [],
  ...extra,
});

describe('computeStats', () => {
  it('sans rien : des zéros, aucun pourcentage inventé', () => {
    const stats = computeStats([], [], NOW);

    expect(stats.funnel).toEqual({
      applied: 0,
      answered: 0,
      interviews: 0,
      rejections: 0,
      unanswered: 0,
      answerRate: null,
      interviewRate: null,
      medianDaysToFirstReply: null,
    });
    expect(stats.pipeline).toEqual({ toReview: 0, toSend: 0, waiting: 0, toFollowUp: 0 });
    expect(stats.bySource).toEqual([]);
    expect(stats.smallSample).toBe(true);
    expect(stats.weekly).toHaveLength(8);
    expect(stats.weekly.every((w) => w.applied === 0)).toBe(true);
  });

  it('compte les candidatures envoyées, les réponses, les entretiens et les refus', () => {
    const stats = computeStats(
      [
        app(),
        app({
          replies: [{ kind: 'ACKNOWLEDGEMENT', receivedAt: daysAgo(2) }],
          status: 'ACKNOWLEDGED',
        }),
        app({ replies: [{ kind: 'INTERVIEW', receivedAt: daysAgo(1) }], status: 'INTERVIEW' }),
        app({ status: 'REJECTED', replies: [{ kind: 'REJECTION', receivedAt: daysAgo(1) }] }),
        app({ status: 'NO_RESPONSE' }),
        // Pas envoyée : ne compte pas dans le tunnel.
        app({ status: 'VALIDATED', appliedAt: null }),
      ],
      [],
      NOW,
    );

    expect(stats.funnel).toMatchObject({
      applied: 5,
      answered: 3,
      interviews: 1,
      rejections: 1,
      unanswered: 2,
      answerRate: 0.6,
      interviewRate: 0.2,
    });
    expect(stats.smallSample).toBe(false);
  });

  it('un statut posé à la main (entretien, refus, accusé) compte comme réponse même sans mail', () => {
    const stats = computeStats(
      [app({ status: 'INTERVIEW' }), app({ status: 'REJECTED' }), app({ status: 'ACKNOWLEDGED' })],
      [],
      NOW,
    );

    expect(stats.funnel).toMatchObject({ answered: 3, interviews: 1, rejections: 1 });
  });

  it('délai médian avant la première réponse (le plus ancien des mails compte)', () => {
    const stats = computeStats(
      [
        app({ appliedAt: daysAgo(10), replies: [{ kind: 'OTHER', receivedAt: daysAgo(8) }] }), // 2 j
        app({
          appliedAt: daysAgo(12),
          replies: [
            { kind: 'REJECTION', receivedAt: daysAgo(5) },
            { kind: 'ACKNOWLEDGEMENT', receivedAt: daysAgo(9) }, // 3 j : le premier
          ],
        }),
        app({ appliedAt: daysAgo(20), replies: [{ kind: 'OTHER', receivedAt: daysAgo(10) }] }), // 10 j
        app(), // sans réponse : ignorée
      ],
      [],
      NOW,
    );

    expect(stats.funnel.medianDaysToFirstReply).toBe(3);
  });

  it('médiane de deux valeurs : leur moyenne ; jamais négative', () => {
    const stats = computeStats(
      [
        app({ appliedAt: daysAgo(10), replies: [{ kind: 'OTHER', receivedAt: daysAgo(8) }] }), // 2
        app({ appliedAt: daysAgo(10), replies: [{ kind: 'OTHER', receivedAt: daysAgo(5) }] }), // 5
      ],
      [],
      NOW,
    );
    expect(stats.funnel.medianDaysToFirstReply).toBe(3.5);

    const odd = computeStats(
      [app({ appliedAt: daysAgo(1), replies: [{ kind: 'OTHER', receivedAt: daysAgo(3) }] })],
      [],
      NOW,
    );
    expect(odd.funnel.medianDaysToFirstReply).toBe(0);
  });

  it('résultats par source, la plus utilisée d’abord', () => {
    const stats = computeStats(
      [
        app({ source: 'INDEED' }),
        app({ source: 'LBA' }),
        app({ source: 'LBA', status: 'INTERVIEW' }),
        app({ source: 'LBA', status: 'REJECTED' }),
      ],
      [],
      NOW,
    );

    expect(stats.bySource).toEqual([
      { source: 'LBA', applied: 3, answered: 2, interviews: 1 },
      { source: 'INDEED', applied: 1, answered: 0, interviews: 0 },
    ]);
  });

  it('huit semaines glissantes depuis le lundi, semaines vides comprises, envois du jour inclus', () => {
    const stats = computeStats(
      [
        app({ appliedAt: new Date('2026-11-09T00:00:00Z') }), // lundi de cette semaine
        app({ appliedAt: new Date('2026-11-11T08:00:00Z') }), // aujourd'hui
        app({ appliedAt: new Date('2026-11-08T23:59:00Z') }), // dimanche : semaine précédente
        app({ appliedAt: new Date('2026-09-20T10:00:00Z') }), // plus de huit semaines : hors graphique
      ],
      [],
      NOW,
    );

    expect(stats.weekly[7]).toEqual({ weekStart: '2026-11-09', applied: 2 });
    expect(stats.weekly[6]).toEqual({ weekStart: '2026-11-02', applied: 1 });
    expect(stats.weekly[0]?.weekStart).toBe('2026-09-21');
    expect(stats.weekly.reduce((sum, w) => sum + w.applied, 0)).toBe(3);
  });

  it('suivi : à valider, à envoyer, en attente, à relancer', () => {
    const stats = computeStats(
      [
        app({ status: 'TO_REVIEW', appliedAt: null }),
        app({ status: 'VALIDATED', appliedAt: null }),
        app({ status: 'DRAFT_CREATED', appliedAt: null }),
        app({ appliedAt: daysAgo(9) }), // à relancer
        app({ appliedAt: daysAgo(2) }), // en attente, trop tôt
        app({ status: 'INTERVIEW' }),
      ],
      [],
      NOW,
    );

    expect(stats.pipeline).toEqual({ toReview: 1, toSend: 2, waiting: 2, toFollowUp: 1 });
  });

  it('relances : combien, et combien de réponses reçues APRÈS la relance', () => {
    const stats = computeStats(
      [
        app({
          appliedAt: daysAgo(20),
          followedUpAt: daysAgo(10),
          replies: [{ kind: 'INTERVIEW', receivedAt: daysAgo(4) }],
        }),
        app({
          appliedAt: daysAgo(20),
          followedUpAt: daysAgo(10),
          // Réponse reçue AVANT la relance : n'est pas un effet de la relance.
          replies: [{ kind: 'ACKNOWLEDGEMENT', receivedAt: daysAgo(15) }],
        }),
        app({ appliedAt: daysAgo(20), followedUpAt: daysAgo(10) }),
        app(),
      ],
      [],
      NOW,
    );

    expect(stats.followUps).toEqual({ sent: 3, answeredAfter: 1 });
  });

  it('offres : total et nouvelles de la semaine, par source', () => {
    const stats = computeStats(
      [],
      [
        { source: 'GLASSDOOR', firstSeenAt: daysAgo(1) },
        { source: 'GLASSDOOR', firstSeenAt: daysAgo(6) },
        { source: 'INDEED', firstSeenAt: daysAgo(2) },
        { source: 'LBA', firstSeenAt: daysAgo(30) },
      ],
      NOW,
    );

    expect(stats.offers).toEqual({
      total: 4,
      newThisWeek: 3,
      newThisWeekBySource: [
        { source: 'GLASSDOOR', count: 2 },
        { source: 'INDEED', count: 1 },
      ],
    });
  });

  it('peu de candidatures (moins de 5) : échantillon trop petit', () => {
    expect(computeStats([app(), app(), app(), app()], [], NOW).smallSample).toBe(true);
    expect(computeStats([app(), app(), app(), app(), app()], [], NOW).smallSample).toBe(false);
  });
});
