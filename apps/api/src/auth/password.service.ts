import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

import { ARGON2_OPTIONS } from './argon2-options';

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
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
