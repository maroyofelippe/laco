import { Module } from '@nestjs/common';
import { BillingModule } from '../cards/billing.module';
import { AlertsController } from './alerts.controller';
import { LimitsController } from './limits.controller';
import { LimitsService } from './limits.service';
import { PushService } from './push.service';

@Module({ imports: [BillingModule], controllers: [LimitsController, AlertsController], providers: [LimitsService, PushService], exports: [LimitsService] })
export class LimitsModule {}
