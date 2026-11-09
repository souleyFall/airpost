import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env';

/** Jeton d'injection de la configuration validée : `@Inject(ENV) env: Env`. */
export const ENV = Symbol('ENV');

// La configuration est lue et validée une seule fois ; tous les modules reçoivent le même objet.
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => parseEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
