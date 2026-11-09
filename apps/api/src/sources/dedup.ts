/**
 * Empreinte d'une offre pour repérer la même annonce publiée par deux sources : entreprise, intitulé et
 * ville, sans accents ni casse ni ponctuation.
 */
export function dedupKey(company: string, title: string, city?: string): string {
  return [company, title, city ?? '']
    .map((part) =>
      part
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .join('|');
}
