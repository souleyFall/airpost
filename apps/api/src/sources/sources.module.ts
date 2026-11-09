import { Module } from '@nestjs/common';
import { AdzunaConnector } from './adzuna/adzuna.connector';
import { LbaConnector } from './lba/lba.connector';
import { LbbConnector } from './lbb/lbb.connector';
import { OffersService } from './offers.service';

@Module({
  providers: [LbaConnector, LbbConnector, AdzunaConnector, OffersService],
  // Le pipeline de collecte utilise les connecteurs et OffersService.
  exports: [LbaConnector, LbbConnector, AdzunaConnector, OffersService],
})
export class SourcesModule {}
