/** « 60 % » ; « — » quand il n'y a rien à diviser (aucune candidature). */
export function percent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  return `${Math.round(rate * 100)} %`;
}

/** « Sem. du 9 nov. » : le lundi de la semaine. */
export function weekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  return `Sem. du ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
}
