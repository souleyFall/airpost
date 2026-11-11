// Contrôle d'isolement de la démo, lancé après `vite build --mode demo`.
// 1. La démo est autonome : en-têtes qui interdisent tout réseau, aucun secret, aucune adresse d'API.
// 2. La version RÉELLE (dist/) ne contient rien de la démo : ni données fictives, ni faux serveur.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEMO_DIR = 'dist-demo';
const REAL_DIR = 'dist';
/** Phrases qui n'existent que dans le code de la démo. */
const DEMO_MARKERS = ['Léa Marchand', 'Atelier Nova', 'aucun serveur derrière'];
/** Formes de secrets (clés d'API) qui ne doivent apparaître dans aucun fichier publié. */
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /GEMINI_API_KEY/,
  /SERPAPI_KEY/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const failures = [];

if (!existsSync(DEMO_DIR)) {
  failures.push(`${DEMO_DIR} introuvable : lance d'abord « vite build --mode demo ».`);
} else {
  const headers = existsSync(join(DEMO_DIR, '_headers'))
    ? readFileSync(join(DEMO_DIR, '_headers'), 'utf8')
    : '';
  if (!headers.includes("connect-src 'none'"))
    failures.push("_headers absent ou sans connect-src 'none'.");
  if (!existsSync(join(DEMO_DIR, 'index.html'))) failures.push('index.html absent de la démo.');
  const bundle = files(DEMO_DIR).filter((f) => /\.(js|html|css|json|webmanifest)$/.test(f));
  const all = bundle.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const marker of DEMO_MARKERS) {
    if (!all.includes(marker))
      failures.push(`Marqueur de démo absent : « ${marker} » (la démo n'est pas dans le build ?).`);
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(all)) failures.push(`Forme de secret trouvée dans la démo : ${pattern}`);
  }
}

if (existsSync(REAL_DIR)) {
  const real = files(REAL_DIR)
    .filter((f) => /\.js$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  for (const marker of DEMO_MARKERS) {
    if (real.includes(marker))
      failures.push(`La version RÉELLE contient du code de démo : « ${marker} ».`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((f) => `✖ ${f}`).join('\n'));
  process.exit(1);
}
console.log(
  '✔ Démo isolée : en-têtes sans réseau, aucun secret, rien de la démo dans la version réelle.',
);
