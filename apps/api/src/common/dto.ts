import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const MONEY_RE = /^\d{1,13}(\.\d{1,2})?$/;
export const MONEY_MSG = 'deve ser um valor decimal positivo em string, ex.: "125.90"';
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const DATE_MSG = 'deve estar no formato YYYY-MM-DD';
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class PageQuery {
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor opaco retornado em nextCursor' })
  @IsOptional() @IsString()
  cursor?: string;
}
