import { describe, expect, it, vi } from 'vitest';
import { GmailError, type GmailClient, type MessageContent } from '../../gmail/gmail.client';
import type { GeocoderService } from '../geocoder.service';
import { SourceError } from '../source.types';
import { IndeedAlertsConnector } from './indeed-alerts.connector';

const QUERY = { latitude: 48.78, longitude: 2.03, radiusKm: 37, romeCodes: [] };
const link = (id: string) => `https://engage.indeed.com/f/a/${id}~~/AAR9hBA~/jeton-${id}~~`;

const GOOD_AUTH = 'mx.google.com; dkim=pass header.i=@jobalert.indeed.com; spf=pass';

const alert = (jobs: [title: string, company: string, place: string, age: string][]) =>
  [
    `${jobs.length} nouveaux emplois développeur - Paris (75)`,
    '',
    ...jobs.flatMap(([title, company, place, age], i) => [
      title,
      `${company} - ${place}`,
      age,
      link(`${title}-${i}`.replace(/\W+/g, '')),
      '',
    ]),
    'Afficher tous les emplois',
  ].join('\n');

const message = (overrides: Partial<MessageContent> = {}): MessageContent => ({
  id: 'm1',
  from: 'Indeed <donotreply@jobalert.indeed.com>',
  authenticationResults: GOOD_AUTH,
  receivedAt: new Date('2026-11-10T03:00:00Z'),
  text: alert([['Développeur Web', 'Atelier Exemple', 'Paris (75)', "Publié à l'instant"]]),
  ...overrides,
});

function setup(
  messages: Record<string, MessageContent> = { m1: message() },
  options: {
    configured?: boolean;
    geocode?: () => { latitude: number; longitude: number } | null;
  } = {},
) {
  const searchMessageIds = vi.fn(async (_query: string, _max: number) => Object.keys(messages));
  const messageContent = vi.fn(async (id: string) => {
    const found = messages[id];
    if (!found) throw new GmailError('unavailable', 'Introuvable.');
    return found;
  });
  const geocodeCity = vi.fn(
    async (_name: string, _near?: { latitude: number; longitude: number }) =>
      options.geocode ? options.geocode() : { latitude: 48.86, longitude: 2.35 },
  );
  const gmail = {
    isConfigured: () => options.configured ?? true,
    searchMessageIds,
    messageContent,
  } as unknown as GmailClient;
  const connector = new IndeedAlertsConnector(gmail, { geocodeCity } as unknown as GeocoderService);
  return { connector, searchMessageIds, messageContent, geocodeCity };
}

describe('IndeedAlertsConnector', () => {
  it('recherche les alertes de l’expéditeur connu, sur 14 jours, 50 messages au plus', async () => {
    const { connector, searchMessageIds } = setup();

    await connector.search(QUERY);

    expect(searchMessageIds).toHaveBeenCalledWith(
      'from:donotreply@jobalert.indeed.com newer_than:14d',
      50,
    );
  });

  it('extrait les annonces, les géocode, et leur donne la source INDEED', async () => {
    const { connector, geocodeCity } = setup();

    const { offers, skipped } = await connector.search(QUERY);

    expect(skipped).toBe(0);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      source: 'INDEED',
      title: 'Développeur Web',
      company: 'Atelier Exemple',
      city: 'Paris',
      latitude: 48.86,
      longitude: 2.35,
    });
    expect(geocodeCity).toHaveBeenCalledWith('Paris', { latitude: 48.78, longitude: 2.03 });
  });

  it('une annonce présente dans plusieurs alertes n’est comptée qu’une fois, la plus récente d’abord', async () => {
    const same = alert([['Développeur Web', 'Atelier Exemple', 'Paris (75)', 'il y a 1 jour']]);
    const { connector } = setup({
      recent: message({ id: 'recent', receivedAt: new Date('2026-11-10T03:00:00Z'), text: same }),
      older: message({ id: 'older', receivedAt: new Date('2026-11-08T03:00:00Z'), text: same }),
    });

    const { offers } = await connector.search(QUERY);

    expect(offers).toHaveLength(1);
    // Version du message le plus récent (listé en premier par Gmail).
    expect(offers[0]?.publishedAt).toEqual(new Date('2026-11-09T03:00:00Z'));
  });

  it('lit tous les messages même au-delà d’un lot parallèle', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `m${i}`,
        message({
          id: `m${i}`,
          text: alert([
            [`Développeur ${i}`, 'Atelier Exemple', 'Paris (75)', "Publié à l'instant"],
          ]),
        }),
      ]),
    );
    const { connector, messageContent } = setup(many);

    const { offers } = await connector.search(QUERY);

    expect(messageContent).toHaveBeenCalledTimes(12);
    expect(offers).toHaveLength(12);
  });

  describe('messages douteux', () => {
    it('ignore un message dont la signature DKIM n’est pas validée pour Indeed (message imité)', async () => {
      const { connector } = setup({
        faux: message({
          id: 'faux',
          authenticationResults: 'mx.google.com; dkim=fail header.d=indeed.com',
        }),
        autre: message({
          id: 'autre',
          authenticationResults: 'mx.google.com; dkim=pass header.d=evil.test',
        }),
        sans: message({ id: 'sans', authenticationResults: '' }),
      });

      const { offers, skipped } = await connector.search(QUERY);

      expect(offers).toHaveLength(0);
      expect(skipped).toBe(3);
    });

    it('ignore un expéditeur différent, même signé par Indeed', async () => {
      const { connector } = setup({
        m: message({ id: 'm', from: 'Pirate <autre@jobalert.indeed.com>' }),
      });

      expect((await connector.search(QUERY)).skipped).toBe(1);
    });

    it('ignore un message sans partie texte (HTML seul), en le comptant', async () => {
      const { connector } = setup({ m: message({ id: 'm', text: null }) });

      expect(await connector.search(QUERY)).toEqual({ offers: [], skipped: 1 });
    });

    it('ne géocode rien pour une ville introuvable, et garde l’annonce sans coordonnées', async () => {
      const { connector } = setup(undefined, { geocode: () => null });

      const { offers } = await connector.search(QUERY);

      expect(offers).toHaveLength(1);
      expect(offers[0]?.latitude).toBeUndefined();
    });
  });

  describe('erreurs', () => {
    it('refuse de s’appeler sans autorisation Gmail, sans rien lire', async () => {
      const { connector, searchMessageIds } = setup(undefined, { configured: false });

      await expect(connector.search(QUERY)).rejects.toMatchObject({
        reason: 'not_configured',
      });
      expect(searchMessageIds).not.toHaveBeenCalled();
    });

    it.each(['unauthorized', 'rate_limited', 'unavailable'] as const)(
      'traduit une erreur Gmail « %s » en erreur de source de même nature',
      async (reason) => {
        const gmail = {
          isConfigured: () => true,
          searchMessageIds: async () => {
            throw new GmailError(reason, 'Détail Gmail.');
          },
        } as unknown as GmailClient;
        const connector = new IndeedAlertsConnector(gmail, {} as GeocoderService);

        const error = await connector.search(QUERY).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SourceError);
        expect(error).toMatchObject({ source: 'INDEED', reason });
        expect((error as Error).message).toContain('Indeed (alertes e-mail)');
      },
    );

    it('ne divulgue ni l’adresse de l’utilisateur ni le contenu des messages dans une erreur', async () => {
      const gmail = {
        isConfigured: () => true,
        searchMessageIds: async () => ['m1'],
        messageContent: async () => {
          throw new GmailError('unavailable', 'Gmail indisponible (503).');
        },
      } as unknown as GmailClient;
      const connector = new IndeedAlertsConnector(gmail, {} as GeocoderService);

      const error = (await connector.search(QUERY).catch((e: unknown) => e)) as Error;

      expect(error.message).toBe('Indeed (alertes e-mail) : Gmail indisponible (503).');
    });
  });
});
