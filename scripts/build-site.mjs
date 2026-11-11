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
// Seule la page d'accueil charge un script (scroll-play.js, même origine) : lecture de la vidéo au défilement.
const PAGE_CSP = LANDING_CSP.replace(
  "default-src 'none';",
  "default-src 'none'; script-src 'self';",
);
const landingHeaders = [
  '/',
  '/index.html',
  '/scroll-play.js',
  '/guide/*',
  '/styles.css',
  '/fonts/*',
  '/airpost.mp4',
  '/poster.jpg',
  '/favicon.svg',
]
  .map(
    (path) =>
      `${path}\n  Content-Security-Policy: ${path === '/' || path === '/index.html' ? PAGE_CSP : LANDING_CSP}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer`,
  )
  .join('\n');
// La démo a son propre _headers à la racine de /demo : on le retire pour ne pas dupliquer les règles.
rmSync(join(OUT, 'demo', '_headers'), { force: true });
writeFileSync(join(OUT, '_headers'), `${landingHeaders}\n${demoHeaders}\n`);

// Vercel n'applique pas `_headers` (format Netlify / Cloudflare Pages) : mêmes règles dans `vercel.json`, générées depuis le même texte pour qu'elles ne divergent pas.
function toVercel(headersText) {
  const rules = [];
  for (const block of headersText.split(/\n(?=\S)/)) {
    const [path, ...lines] = block.trim().split('\n');
    const headers = lines.map((line) => {
      const i = line.indexOf(':');
      return { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
    });
    // « /demo/* » devient « /demo/(.*) » ; « /guide/* » vaut aussi pour « /guide ».
    const source = path.endsWith('/*') ? `${path.slice(0, -2)}/(.*)` : path;
    rules.push({ source, headers });
    if (path === '/guide/*') rules.push({ source: '/guide', headers });
  }
  return rules;
}
const merged = readFileSync(join(OUT, '_headers'), 'utf8');
writeFileSync(
  join(OUT, 'vercel.json'),
  `${JSON.stringify({ trailingSlash: true, headers: toVercel(merged) }, null, 2)}\n`,
);

console.log(`✔ Site assemblé dans ${OUT}`);
