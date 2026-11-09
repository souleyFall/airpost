import { Global, Module } from '@nestjs/common';
import { HTTP_FETCH } from './http-fetch';

// Global : toute fonctionnalité qui appelle un service externe (sources d'offres, géocodage, modèle de langage)
// reçoit la même fonction de requête, que les tests remplacent par un faux sans réseau.
@Global()
@Module({
  providers: [
    { provide: HTTP_FETCH, useValue: (url: string, init?: RequestInit) => fetch(url, init) },
  ],
  exports: [HTTP_FETCH],
})
export class HttpModule {}
