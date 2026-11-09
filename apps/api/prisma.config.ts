import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 ne lit plus le .env tout seul : on charge celui de la racine du dépôt, s'il existe.
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Absente pendant `prisma generate` (qui n'ouvre pas de connexion) : pas d'erreur dans ce cas.
    url: process.env.DATABASE_URL ?? '',
  },
});
