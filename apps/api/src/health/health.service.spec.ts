import { describe, expect, it } from 'vitest';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('renvoie un statut ok avec le nom du service', () => {
    const result = new HealthService().status();

    expect(result).toMatchObject({ status: 'ok', service: 'airpost-api' });
  });

  it("n'expose pas la version : la route est publique", () => {
    expect(new HealthService().status()).not.toHaveProperty('version');
  });

  it("renvoie l'heure courante au format ISO 8601", () => {
    const { time } = new HealthService().status();

    expect(new Date(time).toISOString()).toBe(time);
  });
});
