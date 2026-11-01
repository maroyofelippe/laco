import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID, Matches, ValidateNested } from 'class-validator';
import { AuditService } from '../../common/audit.service';
import { Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { MONEY_MSG, MONEY_RE, MONTH_RE } from '../../common/dto';
import { Errors } from '../../common/errors';
import { monthOf, newId, today, toCents } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';
import { BudgetsService } from './budgets.service';

class MonthQuery {
  @ApiPropertyOptional({ example: '2026-10' }) @IsOptional() @Matches(MONTH_RE, { message: 'month deve estar no formato YYYY-MM' }) month?: string;
}

class BudgetItemDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ example: '1200.00', description: '"0" remove o orçamento da categoria' }) @Matches(MONEY_RE, { message: `plannedAmount ${MONEY_MSG}` }) plannedAmount: string;
}

class SetBudgetsDto {
  @ApiProperty({ type: [BudgetItemDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => BudgetItemDto) items: BudgetItemDto[];
}

@ApiTags('Orçamentos')
@ApiBearerAuth()
@Controller('families/:familyId/budgets')
export class BudgetsController {
  constructor(@InjectDb() private readonly db: Db, private readonly svc: BudgetsService, private readonly audit: AuditService) {}

  @Get()
  get(@Family() ctx: FamilyContext, @Query() q: MonthQuery) {
    return this.svc.monthView(ctx, q.month ?? monthOf(today()));
  }

  @Put()
  @MinRole('ADMIN')
  async set(@Family() ctx: FamilyContext, @Query() q: MonthQuery, @Body() dto: SetBudgetsDto, @Meta() meta: RequestMeta) {
    const month = q.month ?? monthOf(today());
    const ids = [...new Set(dto.items.map((i) => i.categoryId))];
    if (ids.length) {
      const ok = await this.db.selectFrom('categories').select('id').where('family_id', '=', ctx.familyId).where('kind', '=', 'EXPENSE').where('parent_id', 'is', null).where('id', 'in', ids).execute();
      if (ok.length !== ids.length) throw Errors.unprocessable('INVALID_REFERENCE', 'Orçamentos aceitam apenas categorias de despesa de primeiro nível desta família.');
    }
    await this.db.transaction().execute(async (trx) => {
      for (const i of dto.items) {
        if (toCents(i.plannedAmount) === 0) {
          await trx.deleteFrom('budgets').where('family_id', '=', ctx.familyId).where('category_id', '=', i.categoryId).where('reference_month', '=', month).execute();
        } else {
          await trx
            .insertInto('budgets')
            .values({ id: newId(), family_id: ctx.familyId, category_id: i.categoryId, reference_month: month, planned_amount: i.plannedAmount })
            .onDuplicateKeyUpdate({ planned_amount: i.plannedAmount })
            .execute();
        }
      }
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'budget.set', entityType: 'budget', diff: { month, items: dto.items }, meta }, trx);
    });
    return this.svc.monthView(ctx, month);
  }
}
