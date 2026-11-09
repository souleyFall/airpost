import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('produit une empreinte argon2id qui ne contient pas le mot de passe', async () => {
    const hash = await passwords.hash('un mot de passe solide');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('solide');
  });

  it('accepte le bon mot de passe et refuse un mauvais', async () => {
    const hash = await passwords.hash('un mot de passe solide');

    expect(await passwords.verify(hash, 'un mot de passe solide')).toBe(true);
    expect(await passwords.verify(hash, 'un mot de passe solidE')).toBe(false);
    expect(await passwords.verify(hash, '')).toBe(false);
  });

  it('sale chaque empreinte : deux hachages du même mot de passe diffèrent', async () => {
    const [a, b] = await Promise.all([passwords.hash('même texte'), passwords.hash('même texte')]);

    expect(a).not.toBe(b);
  });

  it('répond false, sans lever d’erreur, pour une empreinte illisible', async () => {
    expect(await passwords.verify('pas une empreinte', 'x')).toBe(false);
    expect(await passwords.verify('', 'x')).toBe(false);
  });
});
