import { Module } from '@nestjs/common';
import { HTTP_FETCH } from './http-fetch';
import { AdzunaConnector } from './adzuna/adzuna.connector';
import { LbaConnector } from './lba/lba.connector';
import { LbbConnector } from './lbb/lbb.connector';
import { OffersService } from './offers.service';

@Module({
  providers: [
    // fetch natif de Node ; les tests fournissent un faux.
    { provide: HTTP_FETCH, useValue: (url: string, init?: RequestInit) => fetch(url, init) },
    LbaConnector,
    LbbConnector,
    AdzunaConnector,
    OffersService,
  ],
  // Le pipeline de collecte (PR n°12) utilisera les connecteurs et OffersService.
  exports: [HTTP_FETCH, LbaConnector, LbbConnector, AdzunaConnector, OffersService],
})
export class SourcesModule {}
