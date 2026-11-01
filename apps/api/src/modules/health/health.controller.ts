import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'kysely';
import { Public } from '../../common/context';
import { InjectDb, type Db } from '../../db/database';

@ApiTags('Saúde')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Get()
  async health() {
    const started = Date.now();
    await sql`SELECT 1`.execute(this.db);
    return { status: 'ok', db: 'ok', dbLatencyMs: Date.now() - started, time: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
