import { Module } from '@nestjs/common';
import { AdzunaConnector } from './adzuna/adzuna.connector';
import { LbaConnector } from './lba/lba.connector';
import { GeocoderService } from './geocoder.service';
import { GoogleJobsConnector } from './google-jobs/google-jobs.connector';
import { LbbConnector } from './lbb/lbb.connector';
import { OffersService } from './offers.service';

@Module({
  providers: [
    LbaConnector,
    LbbConnector,
    AdzunaConnector,
    GoogleJobsConnector,
    GeocoderService,
    OffersService,
  ],
  // Le pipeline de collecte utilise les connecteurs, le géocodeur et OffersService.
  exports: [
    LbaConnector,
    LbbConnector,
    AdzunaConnector,
    GoogleJobsConnector,
    GeocoderService,
    OffersService,
  ],
})
export class SourcesModule {}
