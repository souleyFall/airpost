import { Module } from '@nestjs/common';
import { OffersController } from './offers.controller';

@Module({ controllers: [OffersController] })
export class OffersModule {}
