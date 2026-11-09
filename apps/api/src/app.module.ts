import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { CollectionModule } from './collection/collection.module';
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './profile/profile.module';
import { SourcesModule } from './sources/sources.module';

// Le module racine : il assemble les modules de l'application, un par fonctionnalité.
@Module({
  imports: [
    ConfigModule,
    // Limitation de débit par adresse IP : ralentit le brute-force et le balayage de l'API.
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [{ ttl: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX }],
    }),
    PrismaModule,
    AuthModule,
    ProfileModule,
    SourcesModule,
    CollectionModule,
    HealthModule,
  ],
  // Le garde est global : il s'applique à toutes les routes, y compris celles des futurs modules.
  // Il est déclaré avant celui de l'authentification (AuthModule) : on limite le débit avant tout travail.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
