import { describe, expect, it } from 'vitest';
import { ApplicationStatus } from '../generated/prisma/enums';
import {
  AUTOMATIC_ONLY,
  TERMINAL,
  TRANSITIONS,
  canTransition,
  canTransitionManually,
} from './transitions';

const ALL = Object.values(ApplicationStatus);

describe('transitions de candidature', () => {
  it('décrit tous les statuts de la base, ni plus ni moins', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('ne mène que vers des statuts qui existent, sans se pointer elle-même', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        expect(ALL).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it('le refus et le retrait sont définitifs', () => {
    expect([...TERMINAL].sort()).toEqual(['REJECTED', 'WITHDRAWN']);
    for (const to of ALL) {
      expect(canTransition('REJECTED', to)).toBe(false);
      expect(canTransition('WITHDRAWN', to)).toBe(false);
    }
  });

  it.each([
    ['TO_REVIEW', 'VALIDATED'],
    ['VALIDATED', 'TO_REVIEW'],
    ['VALIDATED', 'APPLIED'],
    ['DRAFT_CREATED', 'APPLIED'],
    ['APPLIED', 'ACKNOWLEDGED'],
    ['ACKNOWLEDGED', 'INTERVIEW'],
    ['INTERVIEW', 'REJECTED'],
    ['NO_RESPONSE', 'INTERVIEW'],
  ] as const)('autorise %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['TO_REVIEW', 'APPLIED'], // pas de « postulée » sans validation
    ['TO_REVIEW', 'INTERVIEW'],
    ['VALIDATED', 'INTERVIEW'], // pas d'entretien avant d'avoir postulé
    ['APPLIED', 'TO_REVIEW'], // pas de retour en arrière après l'envoi
    ['APPLIED', 'VALIDATED'],
    ['INTERVIEW', 'ACKNOWLEDGED'],
    ['INTERVIEW', 'NO_RESPONSE'],
  ] as const)('refuse %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('seul le module Gmail pose « brouillon créé »', () => {
    expect(AUTOMATIC_ONLY).toEqual(['DRAFT_CREATED']);
    expect(canTransition('VALIDATED', 'DRAFT_CREATED')).toBe(true);
    expect(canTransitionManually('VALIDATED', 'DRAFT_CREATED')).toBe(false);
    expect(canTransitionManually('VALIDATED', 'APPLIED')).toBe(true);
  });

  it('depuis un statut, on atteint toujours un état final sans boucle infinie', () => {
    // Chaque statut non final mène, de proche en proche, à un statut final.
    for (const start of ALL) {
      const seen = new Set<string>();
      const stack = [start];
      let reachesTerminal = TERMINAL.includes(start);
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        if (TERMINAL.includes(current)) reachesTerminal = true;
        stack.push(...TRANSITIONS[current]);
      }
      expect(reachesTerminal).toBe(true);
    }
  });
});
