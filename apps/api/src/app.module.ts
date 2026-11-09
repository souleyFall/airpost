import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { parseEnv } from './config/env';
import { HealthModule } from './health/health.module';

// Le module racine : il assemble les modules de l'application, un par fonctionnalité.
@Module({
  imports: [
    // Limitation de débit par adresse IP : ralentit le brute-force et le balayage de l'API.
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const env = parseEnv();
        return [{ ttl: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX }];
      },
    }),
    HealthModule,
  ],
  // Le garde est global : il s'applique à toutes les routes, y compris celles des futurs modules.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
