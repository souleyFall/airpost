import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

/**
 * Prépare une base jetable pour les tests d'intégration : `<base>_test`, recréée à chaque lancement
 * puis supprimée. La base de développement n'est jamais touchée.
 */
const rootEnv = resolve(__dirname, '../../../.env');

function testDatabaseName(devName: string): string {
  // Le nom est inséré dans du SQL (CREATE DATABASE n'accepte pas de paramètre) : liste blanche stricte.
  if (!/^[A-Za-z0-9_]+$/.test(devName)) {
    throw new Error('Nom de base inattendu : tests d’intégration annulés.');
  }
  return `${devName}_test`;
}

async function withAdmin<T>(adminUrl: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export default async function setup() {
  if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl || !URL.canParse(devUrl)) {
    throw new Error('DATABASE_URL absente ou invalide : voir .env.example.');
  }

  const url = new URL(devUrl);
  const devName = decodeURIComponent(url.pathname.slice(1));
  const testName = testDatabaseName(devName);

  const testUrl = new URL(devUrl);
  testUrl.pathname = `/${testName}`;

  try {
    await withAdmin(devUrl, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${testName}"`);
    });
  } catch {
    // Pas de valeur de l'URL dans le message : elle contient le mot de passe.
    throw new Error('Base injoignable. Lance d’abord `pnpm db:up`.');
  }

  // Applique les migrations du dépôt : on teste aussi qu'elles s'exécutent sur une base vide.
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  // Les workers de test héritent de cet environnement.
  process.env.DATABASE_URL = testUrl.toString();

  return async () => {
    await withAdmin(devUrl, (client) =>
      client.query(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`),
    );
  };
}
