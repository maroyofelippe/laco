import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { LimitsModule } from '../limits/limits.module';
import { DashboardController } from './dashboard.controller';

@Module({ imports: [AccountsModule, LimitsModule, BudgetsModule], controllers: [DashboardController] })
export class DashboardModule {}
