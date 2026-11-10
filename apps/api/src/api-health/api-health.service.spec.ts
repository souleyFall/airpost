import { describe, expect, it } from 'vitest';
import { statusFromReason } from './api-health.service';

describe('statusFromReason', () => {
  it.each([
    ['rate_limited', 'QUOTA'],
    ['unauthorized', 'AUTH'],
    ['not_configured', 'OFF'],
    ['unavailable', 'DOWN'],
    ['model_unavailable', 'DOWN'],
    ['unexpected', 'DOWN'],
    [undefined, 'DOWN'],
  ] as const)('« %s » donne %s', (reason, status) => {
    expect(statusFromReason(reason)).toBe(status);
  });
});
