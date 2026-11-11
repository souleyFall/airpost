// Assemble le site public dans `site/` : page d'accueil + démo + vidéo. Rien d'autre n'y entre.
//   node scripts/build-site.mjs [--video chemin/airpost.mp4] [--poster chemin/poster.jpg]
// Prérequis : `pnpm --filter @airpost/web build:demo` (dossier apps/web/dist-demo).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const VIDEO = resolve(option('--video', '../airpost-video/out/airpost.mp4'));
const POSTER = resolve(option('--poster', '../airpost-video/out/poster.jpg'));
const OUT = resolve('site');
const LANDING = resolve('apps/landing');
const DEMO = resolve('apps/web/dist-demo');

const missing = [
  [LANDING, 'apps/landing'],
  [DEMO, 'apps/web/dist-demo (lance d’abord « pnpm --filter @airpost/web build:demo »)'],
  [VIDEO, 'la vidéo (option --video)'],
  [POSTER, 'l’affiche de la vidéo (option --poster)'],
].filter(([path]) => !existsSync(path));
if (missing.length > 0) {
  console.error(missing.map(([, label]) => `✖ introuvable : ${label}`).join('\n'));
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(LANDING, OUT, { recursive: true });
cpSync(DEMO, join(OUT, 'demo'), { recursive: true });
cpSync(VIDEO, join(OUT, 'airpost.mp4'));
cpSync(POSTER, join(OUT, 'poster.jpg'));

// En-têtes (format Netlify / Cloudflare Pages). La page d'accueil n'a AUCUN script ; la démo a les siens (dist-demo/_headers),
// qui interdisent tout réseau. Les règles sont séparées par chemin : la politique de la page ne doit pas s'appliquer à /demo/.
const demoHeaders = readFileSync(join(DEMO, '_headers'), 'utf8')
  .replace(/^\/\*\n/, '/demo/*\n')
  .trimEnd();
const LANDING_CSP =
  "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const landingHeaders = [
  '/',
  '/index.html',
  '/guide/*',
  '/styles.css',
  '/fonts/*',
  '/airpost.mp4',
  '/poster.jpg',
  '/favicon.svg',
]
  .map(
    (path) =>
      `${path}\n  Content-Security-Policy: ${LANDING_CSP}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer`,
  )
  .join('\n');
// La démo a son propre _headers à la racine de /demo : on le retire pour ne pas dupliquer les règles.
rmSync(join(OUT, 'demo', '_headers'), { force: true });
writeFileSync(join(OUT, '_headers'), `${landingHeaders}\n${demoHeaders}\n`);

console.log(`✔ Site assemblé dans ${OUT}`);
