import { Module } from '@nestjs/common';
import { BillingModule } from '../cards/billing.module';
import { LimitsModule } from '../limits/limits.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({ imports: [BillingModule, LimitsModule], controllers: [TransactionsController], providers: [TransactionsService], exports: [TransactionsService] })
export class TransactionsModule {}
