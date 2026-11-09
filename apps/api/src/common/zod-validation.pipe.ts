import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Valide un corps de requête avec un schéma Zod. Le message d'erreur donne le champ et le problème,
 * jamais la valeur reçue (ce peut être un mot de passe).
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new BadRequestException({
      message: 'Requête invalide',
      errors: result.error.issues.map((issue) => ({
        champ: issue.path.join('.'),
        probleme: issue.message,
      })),
    });
  }
}
