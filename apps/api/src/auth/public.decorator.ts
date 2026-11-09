import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/**
 * Marque une route (ou un contrôleur) comme accessible sans connexion.
 * Par défaut TOUTES les routes exigent une session : oublier ce décorateur ferme une porte, jamais ne l'ouvre.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
