import { describe, expect, it } from 'vitest';
import { dkimPassDomains, isAuthentic, senderAddress } from './alert-sender';

const RULE = { address: 'donotreply@jobalert.indeed.com', domain: 'indeed.com' };
const GOOD =
  'mx.google.com; dkim=pass header.i=@jobalert.indeed.com header.s=s1 header.b=abc; spf=pass smtp.mailfrom=bounce.indeed.com';

describe('senderAddress', () => {
  it.each([
    ['Indeed <donotreply@jobalert.indeed.com>', 'donotreply@jobalert.indeed.com'],
    ['"Indeed" <DoNotReply@JobAlert.Indeed.com>', 'donotreply@jobalert.indeed.com'],
    ['donotreply@jobalert.indeed.com', 'donotreply@jobalert.indeed.com'],
    ['  donotreply@jobalert.indeed.com  ', 'donotreply@jobalert.indeed.com'],
  ])('« %s » → %s', (from, expected) => {
    expect(senderAddress(from)).toBe(expected);
  });

  it.each(['', 'Indeed', 'pas une adresse <>', '<>', 'a@'])('« %s » : aucune adresse', (from) => {
    expect(senderAddress(from)).toBeNull();
  });

  it('prend la première adresse entre chevrons quand il y en a plusieurs', () => {
    expect(senderAddress('<a@b.fr> <d@e.fr>')).toBe('a@b.fr');
  });

  it('prend l’adresse entre chevrons, pas un nom d’affichage trompeur', () => {
    expect(senderAddress('"donotreply@jobalert.indeed.com" <pirate@evil.test>')).toBe(
      'pirate@evil.test',
    );
  });
});

describe('dkimPassDomains', () => {
  it('relève les domaines dont la signature DKIM a été validée, rien d’autre', () => {
    expect(dkimPassDomains(GOOD)).toEqual(['jobalert.indeed.com']);
    expect(dkimPassDomains('mx; dkim=fail header.d=indeed.com')).toEqual([]);
    expect(dkimPassDomains('mx; spf=pass')).toEqual([]);
    expect(dkimPassDomains('')).toEqual([]);
    expect(
      dkimPassDomains('a; dkim=pass header.d=Indeed.com\nb; dkim=pass header.i=@x.test'),
    ).toEqual(['indeed.com', 'x.test']);
  });
});

describe('isAuthentic', () => {
  it('accepte l’adresse exacte avec une signature DKIM validée du domaine (ou d’un sous-domaine)', () => {
    expect(
      isAuthentic(
        { from: 'Indeed <donotreply@jobalert.indeed.com>', authenticationResults: GOOD },
        RULE,
      ),
    ).toBe(true);
    expect(
      isAuthentic(
        {
          from: 'donotreply@jobalert.indeed.com',
          authenticationResults: 'mx; dkim=pass header.d=indeed.com',
        },
        RULE,
      ),
    ).toBe(true);
  });

  it('refuse une autre adresse, même signée par la plateforme', () => {
    expect(
      isAuthentic({ from: 'autre@jobalert.indeed.com', authenticationResults: GOOD }, RULE),
    ).toBe(false);
  });

  it('refuse une adresse imitée : signature absente, échouée, ou d’un autre domaine', () => {
    const from = 'donotreply@jobalert.indeed.com';
    expect(isAuthentic({ from, authenticationResults: '' }, RULE)).toBe(false);
    expect(
      isAuthentic({ from, authenticationResults: 'mx; dkim=fail header.d=indeed.com' }, RULE),
    ).toBe(false);
    expect(
      isAuthentic({ from, authenticationResults: 'mx; dkim=pass header.d=evil.test' }, RULE),
    ).toBe(false);
    // Un domaine qui se TERMINE comme celui de la plateforme sans en être un sous-domaine.
    expect(
      isAuthentic({ from, authenticationResults: 'mx; dkim=pass header.d=notindeed.com' }, RULE),
    ).toBe(false);
    expect(isAuthentic({ from, authenticationResults: 'mx; spf=pass' }, RULE)).toBe(false);
  });

  it('refuse un nom d’affichage qui imite l’adresse', () => {
    expect(
      isAuthentic(
        {
          from: '"donotreply@jobalert.indeed.com" <pirate@evil.test>',
          authenticationResults: GOOD,
        },
        RULE,
      ),
    ).toBe(false);
  });
});
