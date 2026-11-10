import { Module } from '@nestjs/common';
import { GmailModule } from '../gmail/gmail.module';
import { AdzunaConnector } from './adzuna/adzuna.connector';
import { IndeedAlertsConnector } from './alerts/indeed-alerts.connector';
import { LbaConnector } from './lba/lba.connector';
import { GeocoderService } from './geocoder.service';
import { GlassdoorConnector } from './glassdoor/glassdoor.connector';
import { GoogleJobsConnector } from './google-jobs/google-jobs.connector';
import { LbbConnector } from './lbb/lbb.connector';
import { OffersService } from './offers.service';

@Module({
  // La boîte Gmail de l'utilisateur est la source des alertes d'offres (lecture seule).
  imports: [GmailModule],
  providers: [
    LbaConnector,
    LbbConnector,
    AdzunaConnector,
    GoogleJobsConnector,
    GlassdoorConnector,
    IndeedAlertsConnector,
    GeocoderService,
    OffersService,
  ],
  // Le pipeline de collecte utilise les connecteurs, le géocodeur et OffersService.
  exports: [
    LbaConnector,
    LbbConnector,
    AdzunaConnector,
    GoogleJobsConnector,
    GlassdoorConnector,
    IndeedAlertsConnector,
    GeocoderService,
    OffersService,
  ],
})
export class SourcesModule {}
