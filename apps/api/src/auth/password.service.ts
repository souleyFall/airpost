import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// Paramètres recommandés par l'OWASP pour argon2id : 19 Mio de mémoire, 2 passes, 1 fil.
// argon2id résiste aux attaques par GPU (mémoire) et par canaux auxiliaires. Le sel est aléatoire
// et intégré à l'empreinte.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  /** Renvoie false pour un mot de passe faux ou une empreinte illisible, sans jamais lever d'erreur. */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
