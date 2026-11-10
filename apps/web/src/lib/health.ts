import type { ApiHealthItem } from '../api/types';
import { SOURCE_LABEL } from './format';

/** Nom affiché d'une connexion (une source d'offres, ou le modèle de langage). */
export function connectionLabel(key: string): string {
  if (key === 'GEMINI') return 'Gemini';
  return (SOURCE_LABEL as Record<string, string>)[key] ?? key;
}

/** Connexions qui ne repartiront pas toutes seules : quota atteint ou clé refusée. */
export function blockedConnections(items: ApiHealthItem[]): {
  quota: string[];
  auth: string[];
} {
  const names = (status: ApiHealthItem['status']) =>
    items.filter((item) => item.status === status).map((item) => connectionLabel(item.key));
  return { quota: names('QUOTA'), auth: names('AUTH') };
}

/** « 10/11 à 08:30 » : jour, mois et heure, sans année (l'information est récente). */
export function shortDateTime(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
}
