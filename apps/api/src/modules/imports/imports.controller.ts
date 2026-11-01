import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { memoryStorage } from 'multer';
import { Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { DATE_MSG, DATE_RE, MONEY_MSG, MONEY_RE } from '../../common/dto';
import { Errors } from '../../common/errors';
import { sniffMime } from '../../common/storage.service';
import { ImportsService, MAX_PDF_BYTES } from './imports.service';

class CreateImportDto {
  @ApiProperty({ enum: ['CARD_STATEMENT', 'CHECKING', 'SAVINGS'] }) @IsIn(['CARD_STATEMENT', 'CHECKING', 'SAVINGS']) sourceType: 'CARD_STATEMENT' | 'CHECKING' | 'SAVINGS';
  @ApiPropertyOptional() @IsOptional() @IsUUID() targetAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() targetCardId?: string;
  @ApiPropertyOptional({ description: 'Senha do PDF, se houver (usada só em memória)' }) @IsOptional() @IsString() @MaxLength(100) password?: string;
}

class ItemEditDto {
  @ApiProperty() @IsUUID() itemId: string;
  @ApiPropertyOptional({ enum: ['ACCEPT', 'SKIP'] }) @IsOptional() @IsIn(['ACCEPT', 'SKIP']) decision?: 'ACCEPT' | 'SKIP';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, { message: `occurredOn ${DATE_MSG}` }) occurredOn?: string;
  @ApiPropertyOptional({ enum: ['INCOME', 'EXPENSE'] }) @IsOptional() @IsIn(['INCOME', 'EXPENSE']) type?: 'INCOME' | 'EXPENSE';
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}

class EditItemBody {
  @ApiPropertyOptional({ enum: ['ACCEPT', 'SKIP'] }) @IsOptional() @IsIn(['ACCEPT', 'SKIP']) decision?: 'ACCEPT' | 'SKIP';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, { message: `occurredOn ${DATE_MSG}` }) occurredOn?: string;
  @ApiPropertyOptional({ enum: ['INCOME', 'EXPENSE'] }) @IsOptional() @IsIn(['INCOME', 'EXPENSE']) type?: 'INCOME' | 'EXPENSE';
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}

class ConfirmDto {
  @ApiPropertyOptional({ type: [ItemEditDto], description: 'Correções finais (opcional; também dá para editar item a item)' })
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ItemEditDto) items?: ItemEditDto[];
}

class ListQuery {
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

@ApiTags('Importação de extratos')
@ApiBearerAuth()
@Controller('families/:familyId/imports')
export class ImportsController {
  constructor(private readonly svc: ImportsService) {}

  @Post()
  @MinRole('MEMBER')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'sourceType'], properties: { file: { type: 'string', format: 'binary' }, sourceType: { type: 'string', enum: ['CARD_STATEMENT', 'CHECKING', 'SAVINGS'] }, targetAccountId: { type: 'string' }, targetCardId: { type: 'string' }, password: { type: 'string' } } } })
  @ApiOperation({ summary: 'Envia um extrato em PDF; devolve os itens extraídos para revisão (nada é lançado ainda)' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1 } }))
  create(@Family() ctx: FamilyContext, @UploadedFile() file: Express.Multer.File | undefined, @Body() dto: CreateImportDto, @Meta() meta: RequestMeta) {
    if (!file) throw Errors.validation([{ field: 'file', message: 'envie o PDF no campo "file"' }]);
    if (sniffMime(file.buffer) !== 'application/pdf') throw Errors.unprocessable('UNSUPPORTED_FILE', 'O arquivo enviado não é um PDF.');
    return this.svc.create(ctx, { buffer: file.buffer, originalName: file.originalname || 'extrato.pdf', sourceType: dto.sourceType, targetAccountId: dto.targetAccountId, targetCardId: dto.targetCardId, password: dto.password }, meta);
  }

  @Get()
  list(@Family() ctx: FamilyContext, @Query() q: ListQuery) {
    return this.svc.list(ctx, q.limit);
  }

  @Get(':id')
  get(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Patch(':id/items/:itemId')
  @MinRole('MEMBER')
  editItem(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: EditItemBody) {
    return this.svc.editItem(ctx, id, { ...dto, itemId });
  }

  @Post(':id/confirm')
  @MinRole('MEMBER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirma a importação: cria os lançamentos marcados, de forma atômica' })
  confirm(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDto, @Meta() meta: RequestMeta) {
    return this.svc.confirm(ctx, id, dto.items ?? [], meta);
  }

  @Post(':id/cancel')
  @MinRole('MEMBER')
  @HttpCode(204)
  cancel(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.svc.cancel(ctx, id, meta);
  }
}
