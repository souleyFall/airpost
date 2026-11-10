import { describe, expect, it } from 'vitest';
import { type FollowUpInput, followUpState } from './follow-up';

const NOW = new Date('2026-11-20T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const app = (extra: Partial<FollowUpInput> = {}): FollowUpInput => ({
  status: 'APPLIED',
  appliedAt: daysAgo(9),
  followedUpAt: null,
  lastReplyAt: null,
  ...extra,
});

describe('followUpState', () => {
  it('à relancer : envoyée depuis 8 jours ou plus, sans nouvelle, jamais relancée', () => {
    expect(followUpState(app({ appliedAt: daysAgo(8) }), NOW)).toBe('due');
    expect(followUpState(app({ appliedAt: daysAgo(30) }), NOW)).toBe('due');
  });

  it('trop tôt : rien avant 8 jours', () => {
    expect(followUpState(app({ appliedAt: daysAgo(7.9) }), NOW)).toBeNull();
    expect(followUpState(app({ appliedAt: daysAgo(0) }), NOW)).toBeNull();
  });

  it('un accusé de réception récent repart le délai ; un ancien non', () => {
    expect(followUpState(app({ status: 'ACKNOWLEDGED', lastReplyAt: daysAgo(3) }), NOW)).toBeNull();
    expect(followUpState(app({ status: 'ACKNOWLEDGED', lastReplyAt: daysAgo(9) }), NOW)).toBe(
      'due',
    );
  });

  it('relancée : on attend, puis on propose « sans suite » après 10 jours', () => {
    expect(followUpState(app({ followedUpAt: daysAgo(2) }), NOW)).toBe('done');
    expect(followUpState(app({ followedUpAt: daysAgo(9.9) }), NOW)).toBe('done');
    expect(followUpState(app({ followedUpAt: daysAgo(10) }), NOW)).toBe('give_up');
  });

  it('une seule relance : déjà relancée, jamais « à relancer » de nouveau', () => {
    expect(followUpState(app({ appliedAt: daysAgo(60), followedUpAt: daysAgo(30) }), NOW)).not.toBe(
      'due',
    );
  });

  it.each([
    'TO_REVIEW',
    'VALIDATED',
    'DRAFT_CREATED',
    'INTERVIEW',
    'REJECTED',
    'WITHDRAWN',
  ] as const)('rien à faire au statut %s', (status) => {
    expect(followUpState(app({ status, appliedAt: daysAgo(12) }), NOW)).toBeNull();
  });

  it('« sans réponse » (classé automatiquement après 14 jours) peut encore être relancée une fois', () => {
    expect(followUpState(app({ status: 'NO_RESPONSE', appliedAt: daysAgo(16) }), NOW)).toBe('due');
    // Relancée : on attend, sans proposer de classer sans suite (c'est déjà le statut).
    expect(
      followUpState(
        app({ status: 'NO_RESPONSE', appliedAt: daysAgo(40), followedUpAt: daysAgo(15) }),
        NOW,
      ),
    ).toBe('done');
  });

  it('trop tard : au-delà de 30 jours la relance n’a plus de sens et n’est plus proposée', () => {
    expect(followUpState(app({ appliedAt: daysAgo(30) }), NOW)).toBe('due');
    expect(followUpState(app({ appliedAt: daysAgo(30.5) }), NOW)).toBeNull();
    expect(followUpState(app({ status: 'NO_RESPONSE', appliedAt: daysAgo(90) }), NOW)).toBeNull();
  });

  it('sans date d’envoi, on ne devine pas', () => {
    expect(followUpState(app({ appliedAt: null }), NOW)).toBeNull();
  });
});
