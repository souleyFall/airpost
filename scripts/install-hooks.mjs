// Active les hooks Git du dépôt (dossier .githooks) pour ce clone.
// Lancé automatiquement par `pnpm install` (script « prepare »).
// Sans effet hors d'un clone Git (image Docker, archive) et en CI.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git') || process.env.CI) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  console.log('Hooks Git activés (.githooks).');
} catch {
  // Git absent du PATH : on n'empêche pas l'installation pour autant.
  console.warn('Hooks Git non activés : la commande git est introuvable.');
}
