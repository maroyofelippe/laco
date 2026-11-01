import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { CommonModule } from './common/common.module';
import { FamilyGuard, JwtAuthGuard } from './common/guards';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { config } from './config';
import { DatabaseModule } from './db/database';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuditModule } from './modules/audit/audit.controller';
import { AuthModule } from './modules/auth/auth.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { CardsModule } from './modules/cards/cards.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { FamiliesModule } from './modules/families/families.module';
import { HealthModule } from './modules/health/health.controller';
import { LimitsModule } from './modules/limits/limits.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { UsersModule } from './modules/users/users.module';
import { FilesModule } from './modules/files/files.module';
import { ImportsModule } from './modules/imports/imports.module';
import { RecurrencesModule } from './modules/recurrences/recurrences.module';
import { SyncModule } from './modules/sync/sync.controller';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.isTest ? 'silent' : config.logLevel,
        genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.refreshToken'],
        transport: config.isProd || config.isTest ? undefined : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
        customProps: () => ({ service: 'laco-api' }),
      },
    }),
    // 300 req/min por cliente (auth tem limite próprio de 10/min)
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: config.isTest ? 100_000 : 300 }]),
    DatabaseModule,
    CommonModule,
    HealthModule,
    AuthModule,
    UsersModule,
    FamiliesModule,
    CategoriesModule,
    AccountsModule,
    CardsModule,
    TransactionsModule,
    BudgetsModule,
    LimitsModule,
    DashboardModule,
    AuditModule,
    FilesModule,
    ImportsModule,
    RecurrencesModule,
    SyncModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: FamilyGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
