import { describe, expect, it, vi } from 'vitest';
import { GmailError, type GmailClient, type MessageContent } from '../../gmail/gmail.client';
import type { GeocoderService } from '../geocoder.service';
import { SourceError } from '../source.types';
import { LinkedinAlertsConnector } from './linkedin-alerts.connector';

const QUERY = { latitude: 48.78, longitude: 2.03, radiusKm: 37, romeCodes: [] };
const GOOD_AUTH = 'mx.google.com; dkim=pass header.i=@linkedin.com; spf=pass';

const body = (id: string, title = 'Développeur Web - Alternance') =>
  [
    title,
    'Atelier Exemple',
    'Paris, Île-de-France, France',
    `Voir l’offre d’emploi : https://www.linkedin.com/comm/jobs/view/${id}/?otpToken=SECRET`,
  ].join('\n');

const message = (overrides: Partial<MessageContent> = {}): MessageContent => ({
  id: 'm1',
  from: 'LinkedIn <jobs-listings@linkedin.com>',
  authenticationResults: GOOD_AUTH,
  receivedAt: new Date('2026-11-10T03:00:00Z'),
  text: body('4381718241'),
  ...overrides,
});

function setup(messages: Record<string, MessageContent> = { m1: message() }, configured = true) {
  const searchMessageIds = vi.fn(async (_query: string, _max: number) => Object.keys(messages));
  const messageContent = vi.fn(async (id: string) => messages[id] as MessageContent);
  const geocodeCity = vi.fn(async () => ({ latitude: 48.86, longitude: 2.35 }));
  const gmail = {
    isConfigured: () => configured,
    searchMessageIds,
    messageContent,
  } as unknown as GmailClient;
  const connector = new LinkedinAlertsConnector(gmail, {
    geocodeCity,
  } as unknown as GeocoderService);
  return { connector, searchMessageIds, geocodeCity };
}

describe('LinkedinAlertsConnector', () => {
  it('recherche seulement les expéditeurs connus, sur 14 jours, 50 messages au plus', async () => {
    const { connector, searchMessageIds } = setup();

    await connector.search(QUERY);

    expect(searchMessageIds).toHaveBeenCalledWith(
      '{from:jobs-listings@linkedin.com from:jobs-noreply@linkedin.com from:jobalerts-noreply@linkedin.com} newer_than:14d',
      50,
    );
  });

  it('extrait les annonces, les géocode, et leur donne la source LINKEDIN', async () => {
    const { connector, geocodeCity } = setup();

    const { offers, skipped } = await connector.search(QUERY);

    expect(skipped).toBe(0);
    expect(offers).toEqual([
      expect.objectContaining({
        source: 'LINKEDIN',
        externalId: '4381718241',
        city: 'Paris',
        latitude: 48.86,
        applyUrl: 'https://www.linkedin.com/jobs/view/4381718241/',
      }),
    ]);
    expect(geocodeCity).toHaveBeenCalledWith('Paris', { latitude: 48.78, longitude: 2.03 });
  });

  it('la même annonce dans plusieurs messages n’est gardée qu’une fois', async () => {
    const { connector } = setup({
      a: message({ id: 'a' }),
      b: message({ id: 'b', from: 'LinkedIn <jobs-noreply@linkedin.com>' }),
    });

    expect((await connector.search(QUERY)).offers).toHaveLength(1);
  });

  it('ignore les messages imités, d’un autre expéditeur LinkedIn, ou sans texte, en les comptant', async () => {
    const { connector } = setup({
      faux: message({ id: 'faux', authenticationResults: 'dkim=fail header.d=linkedin.com' }),
      tiers: message({ id: 'tiers', authenticationResults: 'dkim=pass header.d=evil.test' }),
      autre: message({ id: 'autre', from: 'LinkedIn <messages-noreply@linkedin.com>' }),
      html: message({ id: 'html', text: null }),
    });

    expect(await connector.search(QUERY)).toEqual({ offers: [], skipped: 4 });
  });

  it('refuse de s’appeler sans autorisation Gmail, sans rien lire', async () => {
    const { connector, searchMessageIds } = setup(undefined, false);

    await expect(connector.search(QUERY)).rejects.toMatchObject({ reason: 'not_configured' });
    expect(searchMessageIds).not.toHaveBeenCalled();
  });

  it.each(['unauthorized', 'rate_limited', 'unavailable'] as const)(
    'traduit une erreur Gmail « %s » en erreur de source, sans autre détail',
    async (reason) => {
      const gmail = {
        isConfigured: () => true,
        searchMessageIds: async () => {
          throw new GmailError(reason, 'Détail Gmail.');
        },
      } as unknown as GmailClient;
      const connector = new LinkedinAlertsConnector(gmail, {} as GeocoderService);

      const error = await connector.search(QUERY).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SourceError);
      expect(error).toMatchObject({ source: 'LINKEDIN', reason });
      expect((error as Error).message).toBe('LinkedIn (e-mails d’offres) : Détail Gmail.');
    },
  );
});
