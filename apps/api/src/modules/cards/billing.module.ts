import { Module } from '@nestjs/common';
import { BillingCycleService } from './billing-cycle.service';

@Module({ providers: [BillingCycleService], exports: [BillingCycleService] })
export class BillingModule {}
