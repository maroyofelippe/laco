import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({ imports: [TransactionsModule], controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
