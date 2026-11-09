import { useOutletContext } from 'react-router-dom';

/** Ce que le cadre de l'application partage avec les écrans qu'il contient. */
export interface ShellContext {
  /** Augmente après chaque collecte : les écrans rechargent leurs données. */
  version: number;
  /** Les écrans publient ici leur compteur affiché dans la barre latérale. */
  setCount: (key: 'review' | 'tracking', value: number | null) => void;
}

export function useShell(): ShellContext {
  return useOutletContext<ShellContext>();
}
