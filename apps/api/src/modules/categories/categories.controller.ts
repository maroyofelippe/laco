import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { AuditService } from '../../common/audit.service';
import { Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { Errors } from '../../common/errors';
import { bool, newId } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';
import type { Category } from '../../db/types';

class ListCategoriesQuery {
  @ApiPropertyOptional({ enum: ['INCOME', 'EXPENSE', 'TRANSFER'] }) @IsOptional() @IsIn(['INCOME', 'EXPENSE', 'TRANSFER']) kind?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includeInactive?: boolean;
}

class CreateCategoryDto {
  @ApiProperty({ example: 'Pets' }) @IsString() @Length(1, 60) name: string;
  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] }) @IsIn(['INCOME', 'EXPENSE']) kind: 'INCOME' | 'EXPENSE';
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) icon?: string;
  @ApiPropertyOptional({ example: '#5B8E7D' }) @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) color?: string;
}

class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) icon?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) color?: string;
}

export const toCategoryDto = (c: Category) => ({
  id: c.id, name: c.name, kind: c.kind, parentId: c.parent_id, icon: c.icon, color: c.color,
  isSystem: bool(c.is_system), isActive: bool(c.is_active), version: c.version,
});

@ApiTags('Categorias')
@ApiBearerAuth()
@Controller('families/:familyId/categories')
export class CategoriesController {
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService) {}

  @Get()
  async list(@Family() ctx: FamilyContext, @Query() q: ListCategoriesQuery) {
    let query = this.db.selectFrom('categories').selectAll().where('family_id', '=', ctx.familyId);
    if (q.kind) query = query.where('kind', '=', q.kind);
    if (!q.includeInactive) query = query.where('is_active', '=', 1);
    const rows = await query.orderBy('kind').orderBy('name').execute();
    return rows.map(toCategoryDto);
  }

  @Post()
  @MinRole('ADMIN')
  async create(@Family() ctx: FamilyContext, @Body() dto: CreateCategoryDto, @Meta() meta: RequestMeta) {
    if (dto.parentId) {
      const parent = await this.find(ctx, dto.parentId);
      if (parent.parent_id) throw Errors.unprocessable('CATEGORY_DEPTH', 'Categorias suportam apenas dois níveis.');
      if (parent.kind !== dto.kind) throw Errors.unprocessable('CATEGORY_KIND_MISMATCH', 'A subcategoria deve ter o mesmo tipo da categoria pai.');
    }
    const id = newId();
    await this.db
      .insertInto('categories')
      .values({ id, family_id: ctx.familyId, parent_id: dto.parentId ?? null, name: dto.name.trim(), kind: dto.kind, icon: dto.icon ?? null, color: dto.color ?? null, is_system: false, is_active: true })
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'category.create', entityType: 'category', entityId: id, diff: dto, meta });
    return toCategoryDto(await this.find(ctx, id));
  }

  @Patch(':id')
  @MinRole('ADMIN')
  async update(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @Headers('if-match') ifMatch: string | undefined, @Meta() meta: RequestMeta) {
    const cat = await this.find(ctx, id);
    if (ifMatch && Number(ifMatch) !== cat.version) throw Errors.conflict('VERSION_CONFLICT', 'A categoria foi alterada por outra pessoa. Recarregue para ver a versão atual.', { currentVersion: cat.version });
    await this.db
      .updateTable('categories')
      .set((eb) => ({
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.icon ? { icon: dto.icon } : {}),
        ...(dto.color ? { color: dto.color } : {}),
        version: eb('version', '+', 1),
      }))
      .where('family_id', '=', ctx.familyId)
      .where('id', '=', id)
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'category.update', entityType: 'category', entityId: id, diff: { before: { name: cat.name }, after: dto }, meta });
    return toCategoryDto(await this.find(ctx, id));
  }

  @Post(':id/deactivate')
  @MinRole('ADMIN')
  @HttpCode(200)
  async deactivate(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const cat = await this.find(ctx, id);
    if (bool(cat.is_system)) throw Errors.unprocessable('CATEGORY_SYSTEM', 'Categorias do sistema não podem ser desativadas.');
    // Desativa também as subcategorias; lançamentos antigos são preservados
    await this.db
      .updateTable('categories')
      .set((eb) => ({ is_active: false, version: eb('version', '+', 1) }))
      .where('family_id', '=', ctx.familyId)
      .where((eb) => eb.or([eb('id', '=', id), eb('parent_id', '=', id)]))
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'category.deactivate', entityType: 'category', entityId: id, meta });
    return toCategoryDto(await this.find(ctx, id));
  }

  @Post(':id/activate')
  @MinRole('ADMIN')
  @HttpCode(200)
  async activate(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const cat = await this.find(ctx, id);
    if (cat.parent_id) {
      const parent = await this.find(ctx, cat.parent_id);
      if (!bool(parent.is_active)) throw Errors.unprocessable('CATEGORY_PARENT_INACTIVE', 'Ative primeiro a categoria pai.');
    }
    await this.db.updateTable('categories').set((eb) => ({ is_active: true, version: eb('version', '+', 1) })).where('family_id', '=', ctx.familyId).where('id', '=', id).execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'category.activate', entityType: 'category', entityId: id, meta });
    return toCategoryDto(await this.find(ctx, id));
  }

  private async find(ctx: FamilyContext, id: string) {
    const c = await this.db.selectFrom('categories').selectAll().where('family_id', '=', ctx.familyId).where('id', '=', id).executeTakeFirst();
    if (!c) throw Errors.notFound('Categoria');
    return c;
  }
}
