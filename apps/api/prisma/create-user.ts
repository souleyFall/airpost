import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';
import { z } from 'zod';
import { ARGON2_OPTIONS } from '../src/auth/argon2-options';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Crée (ou remplace) l'unique utilisateur de l'application. Il n'y a volontairement pas d'inscription
 * en ligne : l'application est personnelle, le compte se crée depuis la machine.
 *
 *   pnpm --filter @airpost/api user:create <identifiant>
 *
 * Le mot de passe est demandé sans écho, jamais passé en argument (il resterait dans l'historique du
 * shell et dans la liste des processus) ni dans une variable d'environnement.
 */
const loginSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
// 12 caractères minimum : la longueur compte plus que la complexité (recommandation NIST).
const passwordSchema = z.string().min(12).max(256);

/**
 * Une seule interface de lecture pour toutes les questions (en ouvrir une par question perd les lignes
 * déjà lues quand l'entrée est redirigée). La sortie de readline est muette : en terminal, les caractères
 * tapés ne sont donc pas affichés ; les questions sont écrites directement sur la sortie standard.
 */
function createPrompter() {
  const silent = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const rl = createInterface({
    input: process.stdin,
    output: silent,
    terminal: Boolean(process.stdin.isTTY),
  });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async askHidden(question: string): Promise<string> {
      process.stdout.write(question);
      const { value } = await lines.next();
      process.stdout.write('\n');
      // Windows PowerShell 5.1 ajoute un BOM (U+FEFF) au début d'une entrée redirigée.
      return typeof value === 'string' ? value.replace(/^\p{Cf}/u, '') : '';
    },
    close: () => rl.close(),
  };
}

async function main() {
  const login = loginSchema.safeParse(process.argv[2]);
  if (!login.success) {
    throw new Error('Identifiant requis : 3 à 64 caractères (lettres, chiffres, . _ -).');
  }
  const prompter = createPrompter();
  const password = await prompter.askHidden('Mot de passe (12 caractères minimum) : ');
  const confirmation = await prompter.askHidden('Confirme le mot de passe : ');
  prompter.close();
  if (password !== confirmation) {
    throw new Error('Les deux mots de passe sont différents.');
  }
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    throw new Error('Mot de passe trop court : 12 caractères minimum.');
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL absente : voir .env.example.');
  }
  // Mêmes paramètres que l'API : une seule définition.
  const passwordHash = await hash(parsed.data, ARGON2_OPTIONS);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await prisma.user.upsert({
      where: { login: login.data },
      update: { passwordHash },
      create: { login: login.data, passwordHash },
    });
    // Changer le mot de passe déconnecte tous les appareils.
    await prisma.session.deleteMany({ where: { user: { login: login.data } } });
    console.log(`Utilisateur « ${login.data} » prêt.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Messages maison uniquement : une erreur de connexion pourrait contenir l'URL (mot de passe).
  const known = error instanceof Error && !/postgres|connect|ECONN|password/i.test(error.message);
  console.error(known ? error.message : 'Échec : voir la configuration de la base.');
  process.exit(1);
});
