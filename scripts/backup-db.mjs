// Sauvegarde de la base : `pnpm db:backup` écrit un fichier SQL horodaté dans ./backups (ignoré par Git).
// Le fichier contient des données personnelles (lettres, candidatures, profil) : le garder sur ton ordinateur,
// le chiffrer s'il quitte la machine, et le supprimer quand il n'est plus utile.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const file = join('backups', `airpost-${stamp}.sql`);

// pg_dump tourne dans le conteneur : identifiants lus dans son propre environnement, jamais passés ici.
const dump = spawn(
  'docker',
  ['compose', 'exec', '-T', 'db', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"'],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
dump.stdout.pipe(createWriteStream(file, { mode: 0o600 }));
dump.on('close', (code) => {
  if (code === 0) {
    console.log(`Sauvegarde écrite : ${file}`);
  } else {
    console.error('Échec de la sauvegarde : la base est-elle démarrée (pnpm db:up) ?');
    process.exit(1);
  }
});
