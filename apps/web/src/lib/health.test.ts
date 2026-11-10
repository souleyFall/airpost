import { describe, expect, it } from 'vitest';
import type { ApiHealthItem } from '../api/types';
import { blockedConnections, connectionLabel } from './health';

const item = (key: string, status: ApiHealthItem['status']): ApiHealthItem => ({
  key,
  status,
  checkedAt: '2026-11-10T08:30:00Z',
  lastOkAt: null,
});

describe('health', () => {
  it('nomme les connexions comme à l’écran', () => {
    expect(connectionLabel('GLASSDOOR')).toBe('Glassdoor');
    expect(connectionLabel('GEMINI')).toBe('Gemini');
    expect(connectionLabel('INCONNUE')).toBe('INCONNUE');
  });

  it('ne retient que les quotas atteints et les clés refusées (une panne ou une source désactivée ne sont pas bloquantes)', () => {
    const items = [
      item('GLASSDOOR', 'QUOTA'),
      item('GEMINI', 'QUOTA'),
      item('LBA', 'AUTH'),
      item('LBB', 'DOWN'),
      item('INDEED', 'OFF'),
      item('ADZUNA', 'OK'),
    ];

    expect(blockedConnections(items)).toEqual({
      quota: ['Glassdoor', 'Gemini'],
      auth: ['La Bonne Alternance'],
    });
    expect(blockedConnections([item('LBA', 'OK')])).toEqual({ quota: [], auth: [] });
  });
});
