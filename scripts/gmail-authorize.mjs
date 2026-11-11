// Autorise airpost à utiliser TA boîte Gmail et écrit `token.json` (à la racine, ignoré par Git).
//   node scripts/gmail-authorize.mjs [--force]
// Prérequis : `credentials.json` (client OAuth « Application de bureau » téléchargé depuis Google Cloud).
// Étendues demandées : gmail.compose (créer des brouillons) et gmail.readonly (lire les réponses).
// Jamais gmail.send : airpost ne peut pas envoyer un message, il prépare seulement des brouillons.
// Le jeton n'est jamais affiché : il va uniquement dans le fichier.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const CREDENTIALS = resolve('credentials.json');
const TOKEN = resolve('token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
];
const FORCE = process.argv.includes('--force');

function stop(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!existsSync(CREDENTIALS))
  stop('credentials.json introuvable à la racine du projet (voir l’étape « Gmail » du guide).');
if (existsSync(TOKEN) && !FORCE)
  stop('token.json existe déjà. Relance avec --force pour le remplacer.');

let client;
try {
  client = JSON.parse(readFileSync(CREDENTIALS, 'utf8')).installed;
} catch {
  stop('credentials.json illisible (JSON invalide).');
}
if (!client?.client_id || !client?.client_secret)
  stop(
    'credentials.json doit venir d’un client OAuth de type « Application de bureau » (clé « installed »).',
  );

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');

const server = createServer();
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const redirect = `http://127.0.0.1:${server.address().port}`;

const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: redirect,
  response_type: 'code',
  scope: SCOPES.join(' '),
  access_type: 'offline',
  prompt: 'consent',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

console.log(
  '\nOuvre ce lien dans ton navigateur, connecte-toi et accepte les deux autorisations :\n',
);
console.log(url.toString());
console.log('\nEn attente de la réponse de Google (Ctrl+C pour annuler)…');

const code = await new Promise((ok, ko) => {
  const timer = setTimeout(() => ko(new Error('Délai dépassé (5 minutes).')), 5 * 60_000);
  server.on('request', (req, res) => {
    const params = new URL(req.url, redirect).searchParams;
    if (!params.has('code') && !params.has('error')) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    if (params.get('state') !== state || params.has('error')) {
      res.end('Autorisation refusée ou invalide. Reviens au terminal.');
      clearTimeout(timer);
      ko(new Error(`Google a répondu : ${params.get('error') ?? 'état invalide'}.`));
      return;
    }
    res.end('C’est fait : tu peux fermer cet onglet et revenir au terminal.');
    clearTimeout(timer);
    ok(params.get('code'));
  });
}).catch((error) => stop(error.message));
server.close();

const response = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok || !body.refresh_token)
  stop(
    `Google n’a pas fourni de jeton de renouvellement (${body.error ?? response.status}). ` +
      'Retire l’accès d’airpost sur https://myaccount.google.com/permissions puis recommence.',
  );

writeFileSync(
  TOKEN,
  `${JSON.stringify({ refresh_token: body.refresh_token, scope: body.scope }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log('✔ token.json écrit. Redémarre l’API : docker compose up -d --build api');
