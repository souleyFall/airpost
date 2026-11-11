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
// Un seul script est permis sur l'accueil : scroll-play.js, local, sans code dans la page.
const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
if (scripts.length !== 1 || !/^<script src="scroll-play\.js" defer>$/.test(scripts[0] ?? ''))
  fail('index.html : un seul <script src="scroll-play.js" defer> est permis.');
if (/<script\b[^>]*>(?!\s*<\/script>)\s*\S/i.test(html))
  fail('index.html contient du code dans la page.');
if (!existsSync(join(SITE, 'scroll-play.js'))) fail('scroll-play.js manquant.');
else if (
  /\b(?:fetch|XMLHttpRequest|WebSocket|eval|sendBeacon|document\.cookie|localStorage|import\()/.test(
    readFileSync(join(SITE, 'scroll-play.js'), 'utf8'),
  )
)
  fail('scroll-play.js : appel réseau ou stockage interdit.');
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

// Les attributs style sont bloqués par la politique de sécurité (style-src 'self') : classes CSS à la place.
for (const [name, page] of [
  ['index.html', html],
  ['guide/index.html', guide ?? ''],
])
  if (/\sstyle\s*=/i.test(page)) fail(`${name} contient un attribut style (bloqué par la CSP).`);

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

// 2 bis. Aperçu de partage : adresses absolues, image présente, 1200 x 630 et légère.
for (const [name, page] of [
  ['index.html', html],
  ['guide/index.html', guide ?? ''],
]) {
  if (page.includes('%SITE_URL%')) fail(`${name} : adresse publique non substituée (%SITE_URL%).`);
  const meta = (key) =>
    page.match(new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`))?.[1];
  for (const key of [
    'og:title',
    'og:description',
    'og:url',
    'og:image',
    'twitter:card',
    'twitter:image',
  ])
    if (!meta(key)) fail(`${name} : balise ${key} absente.`);
  for (const key of ['og:image', 'twitter:image', 'og:url'])
    if (meta(key) && !/^https:\/\//.test(meta(key)))
      fail(`${name} : ${key} doit être une adresse https absolue.`);
  if (meta('twitter:card') !== 'summary_large_image') fail(`${name} : twitter:card inattendu.`);
}
const ogFile = join(SITE, 'og-image.jpg');
if (!existsSync(ogFile)) fail('og-image.jpg manquant.');
else {
  const jpg = readFileSync(ogFile);
  if (jpg.length > 300 * 1024)
    fail('og-image.jpg dépasse 300 Ko (LinkedIn et d’autres refusent les images trop lourdes).');
  let w = 0,
    h = 0;
  for (let i = 2; i + 9 < jpg.length;) {
    if (jpg[i] !== 0xff) break;
    const marker = jpg[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      h = jpg.readUInt16BE(i + 5);
      w = jpg.readUInt16BE(i + 7);
      break;
    }
    i += 2 + jpg.readUInt16BE(i + 2);
  }
  if (w !== 1200 || h !== 630) fail(`og-image.jpg doit faire 1200 x 630 (trouvé ${w} x ${h}).`);
}

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
if (!/default-src 'none';(?: script-src 'self';)? style-src 'self'/.test(headers))
  fail('_headers : politique de la page d’accueil absente.');
if (!/\/demo\/\*[\s\S]*connect-src 'none'/.test(headers))
  fail("_headers : la démo doit avoir connect-src 'none'.");
const landingPart = headers.split('/demo/*')[0] ?? '';
if ((landingPart.match(/script-src[^;]*/g) ?? []).some((v) => v !== "script-src 'self'"))
  fail("_headers : seul script-src 'self' est permis sur la page d’accueil.");
if (/\/guide\/\*\s+Content-Security-Policy:[^\n]*script-src/.test(headers))
  fail('_headers : le guide ne doit autoriser aucun script.');

// 5 bis. Vercel : vercel.json reprend les mêmes protections que _headers.
if (!existsSync(join(SITE, 'vercel.json'))) fail('vercel.json manquant (hébergement Vercel).');
else {
  const vercel = JSON.parse(readFileSync(join(SITE, 'vercel.json'), 'utf8'));
  const valueOf = (source, key) =>
    vercel.headers?.find((r) => r.source === source)?.headers.find((h) => h.key === key)?.value ??
    '';
  if (!valueOf('/demo/(.*)', 'Content-Security-Policy').includes("connect-src 'none'"))
    fail("vercel.json : la démo doit avoir connect-src 'none'.");
  for (const source of ['/', '/guide/(.*)', '/guide'])
    if (!valueOf(source, 'Content-Security-Policy').startsWith("default-src 'none'"))
      fail(`vercel.json : politique absente pour ${source}.`);
  const home = valueOf('/', 'Content-Security-Policy');
  if (/script-src/.test(home) && !/script-src 'self';/.test(home))
    fail("vercel.json : seul script-src 'self' est permis sur la page d’accueil.");
  if (/script-src/.test(valueOf('/guide', 'Content-Security-Policy')))
    fail('vercel.json : le guide ne doit autoriser aucun script.');
}

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
console.log('✔ Site contrôlé : un seul script local, aucun lien cassé, aucun secret, démo isolée.');
