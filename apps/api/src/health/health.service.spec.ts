import { describe, expect, it } from 'vitest';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('renvoie un statut ok avec le nom du service et sa version', () => {
    const result = new HealthService().status();

    expect(result).toMatchObject({ status: 'ok', service: 'airpost-api', version: '0.0.0' });
  });

  it("renvoie l'heure courante au format ISO 8601", () => {
    const { time } = new HealthService().status();

    expect(new Date(time).toISOString()).toBe(time);
  });
});
