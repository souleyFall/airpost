// Contrôle du site assemblé (`site/`) : page d'accueil sans script ni ressource externe, liens locaux valides,
// aucun secret, démo isolée.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SITE = resolve('site');
const failures = [];
const fail = (message) => failures.push(message);

if (!existsSync(SITE)) {
  console.error('✖ site/ introuvable : lance d’abord « node scripts/build-site.mjs ».');
  process.exit(1);
}

const html = readFileSync(join(SITE, 'index.html'), 'utf8');
const guide = existsSync(join(SITE, 'guide', 'index.html'))
  ? readFileSync(join(SITE, 'guide', 'index.html'), 'utf8')
  : null;
if (guide === null) fail('guide/index.html manquant.');

// 1. Aucun script sur la page d'accueil, aucune ressource tierce chargée automatiquement.
if (/<script\b/i.test(html)) fail('index.html contient un <script>.');
if (guide && /<script\b|\son[a-z]+\s*=/i.test(guide)) fail('guide/index.html contient un script.');
if (/\son[a-z]+\s*=/i.test(html)) fail('index.html contient un gestionnaire d’événement en ligne.');
for (const match of html.matchAll(
  /<(?:link|img|source|video|iframe)\b[^>]*\b(?:src|href|poster)\s*=\s*"(https?:)?\/\/[^"]+"/gi,
)) {
  if (!/<a\b/i.test(match[0]) && !/rel="(?:canonical|me)"/.test(match[0]))
    fail(`Ressource externe chargée : ${match[0].slice(0, 80)}`);
}
const css = readFileSync(join(SITE, 'styles.css'), 'utf8');
if (/url\(\s*['"]?https?:/i.test(css) || /@import/i.test(css))
  fail('styles.css charge une ressource externe.');

// 2. Chaque lien et ressource locale existe.
for (const match of html.matchAll(/\b(?:href|src|poster)="([^"#:]+)(?:#[^"]*)?"/g)) {
  const target = match[1];
  if (target === '' || target.startsWith('mailto')) continue;
  if (!existsSync(join(SITE, target))) fail(`Lien local cassé : ${target}`);
}
for (const match of css.matchAll(/url\('?([^')]+)'?\)/g)) {
  if (!existsSync(join(SITE, match[1]))) fail(`Police ou ressource CSS introuvable : ${match[1]}`);
}

// Le guide : liens locaux (relatifs à guide/) et ancres internes valides.
if (guide) {
  for (const match of guide.matchAll(/\b(?:href|src)="([^"#:]+)(?:#[^"]*)?"/g)) {
    const target = match[1];
    if (target === '' || target.startsWith('mailto')) continue;
    const path = join(SITE, 'guide', target);
    if (!existsSync(path)) fail(`guide : lien local cassé : ${target}`);
  }
  const ids = new Set([...guide.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const match of guide.matchAll(/\bhref="#([^"]+)"/g))
    if (!ids.has(match[1])) fail(`guide : ancre introuvable : #${match[1]}`);
  if ((guide.match(/<h1\b/g) ?? []).length !== 1) fail('guide : exactement un <h1> attendu.');
}
if (!/href="guide\/"/.test(html)) fail('La page d’accueil ne renvoie pas vers guide/.');

// 3. Accessibilité de base : langue, titre, vidéo avec commandes, un seul h1, texte alternatif des images.
if (!/<html[^>]*\blang="fr"/.test(html)) fail('Attribut lang="fr" absent.');
if (!/<title>[^<]{10,}<\/title>/.test(html)) fail('Titre de page absent ou trop court.');
if ((html.match(/<h1\b/g) ?? []).length !== 1) fail('La page doit avoir exactement un <h1>.');
if (!/<video\b[^>]*\bcontrols\b/.test(html)) fail('La vidéo n’a pas de commandes.');
for (const img of html.matchAll(/<img\b[^>]*>/g))
  if (!/\balt=/.test(img[0])) fail('Image sans attribut alt.');

// 4. Aucun secret dans aucun fichier texte du site.
const SECRET = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  // Le nom d'une variable (documenté dans le guide) est permis ; une valeur affectée ne l'est pas.
  /(?:GEMINI_API_KEY|SERPAPI_KEY|LBA_API_KEY|ADZUNA_APP_KEY|FT_CLIENT_SECRET)\s*=\s*[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
];
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
for (const file of walk(SITE).filter((f) =>
  /\.(html|css|js|json|svg|txt|webmanifest)$|_headers$/.test(f),
)) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of SECRET)
    if (pattern.test(text)) fail(`Forme de secret dans ${file.replace(SITE, '')} : ${pattern}`);
}

// 5. En-têtes : la page n'autorise aucun script ; la démo interdit tout réseau.
const headers = existsSync(join(SITE, '_headers'))
  ? readFileSync(join(SITE, '_headers'), 'utf8')
  : '';
if (!/\/guide\/\*\s+Content-Security-Policy: default-src 'none'/.test(headers))
  fail('_headers : politique du guide absente.');
if (!headers.includes("default-src 'none'; style-src 'self'"))
  fail('_headers : politique de la page d’accueil absente.');
if (!/\/demo\/\*[\s\S]*connect-src 'none'/.test(headers))
  fail("_headers : la démo doit avoir connect-src 'none'.");
if (/script-src/.test(headers.split('/demo/*')[0] ?? ''))
  fail('_headers : la page d’accueil ne doit autoriser aucun script.');

// 6. La démo est bien dedans et marche sous /demo/.
for (const file of ['demo/index.html'])
  if (!existsSync(join(SITE, file))) fail(`${file} manquant.`);
if (existsSync(join(SITE, 'demo', 'index.html'))) {
  const demo = readFileSync(join(SITE, 'demo', 'index.html'), 'utf8');
  if (!/(?:src|href)="\.\/assets\//.test(demo))
    fail('La démo doit utiliser des liens relatifs (./assets/…).');
}

if (failures.length > 0) {
  console.error(failures.map((f) => `✖ ${f}`).join('\n'));
  process.exit(1);
}
console.log('✔ Site contrôlé : page sans script, aucun lien cassé, aucun secret, démo isolée.');
