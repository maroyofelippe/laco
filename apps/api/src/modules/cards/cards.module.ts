import { Module } from '@nestjs/common';
import { BillingModule } from './billing.module';
import { CardsController } from './cards.controller';

@Module({ imports: [BillingModule], controllers: [CardsController] })
export class CardsModule {}
