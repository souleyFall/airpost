// Paramètres recommandés par l'OWASP pour argon2id : 19 Mio de mémoire, 2 passes, 1 fil.
// argon2id résiste aux attaques par GPU (mémoire) et par canaux auxiliaires. Le sel est aléatoire
// et intégré à l'empreinte. Une seule définition, partagée par l'API et par le script user:create.
export const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
