import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { DATE_MSG, DATE_RE, MONEY_MSG, MONEY_RE, PageQuery } from '../../common/dto';

export class CreateTransactionDto {
  @ApiPropertyOptional({ description: 'UUID gerado no app (modo offline)' }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] }) @IsIn(['INCOME', 'EXPENSE']) type: 'INCOME' | 'EXPENSE';
  @ApiProperty({ example: '312.45' }) @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount: string;
  @ApiProperty({ example: 'Supermercado Dia' }) @IsString() @Length(1, 200) description: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() memberUserId?: string;
  @ApiProperty({ example: '2026-10-24' }) @Matches(DATE_RE, { message: `occurredOn ${DATE_MSG}` }) occurredOn: string;
  @ApiPropertyOptional({ enum: ['PENDING', 'CLEARED'] }) @IsOptional() @IsIn(['PENDING', 'CLEARED']) status?: 'PENDING' | 'CLEARED';
  @ApiPropertyOptional({ enum: ['MANUAL', 'RECEIPT_OCR'] }) @IsOptional() @IsIn(['MANUAL', 'RECEIPT_OCR']) source?: 'MANUAL' | 'RECEIPT_OCR';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateInstallmentsDto {
  @ApiPropertyOptional({ description: 'UUID do plano (opcional)' }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ example: 'Notebook' }) @IsString() @Length(1, 200) description: string;
  @ApiProperty({ example: '4800.00' }) @Matches(MONEY_RE, { message: `totalAmount ${MONEY_MSG}` }) totalAmount: string;
  @ApiProperty({ example: 10 }) @IsInt() @Min(2) @Max(72) installments: number;
  @ApiProperty({ example: '2026-10-26' }) @Matches(DATE_RE, { message: `firstDate ${DATE_MSG}` }) firstDate: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() memberUserId?: string;
}

export class CreateTransferDto {
  @ApiProperty() @IsUUID() fromAccountId: string;
  @ApiProperty() @IsUUID() toAccountId: string;
  @ApiProperty({ example: '500.00' }) @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount: string;
  @ApiProperty({ example: '2026-10-26' }) @Matches(DATE_RE, { message: `occurredOn ${DATE_MSG}` }) occurredOn: string;
  @ApiPropertyOptional({ example: 'Reserva de emergência' }) @IsOptional() @IsString() @Length(1, 200) description?: string;
}

export class UpdateTransactionDto {
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() memberUserId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, { message: `occurredOn ${DATE_MSG}` }) occurredOn?: string;
  @ApiPropertyOptional({ enum: ['PENDING', 'CLEARED'] }) @IsOptional() @IsIn(['PENDING', 'CLEARED']) status?: 'PENDING' | 'CLEARED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class ScopeQuery {
  @ApiPropertyOptional({ enum: ['this', 'future', 'all'], default: 'this', description: 'Para parcelas: só esta, esta e futuras, ou todas' })
  @IsOptional() @IsIn(['this', 'future', 'all']) scope?: 'this' | 'future' | 'all';
}

export class ListTransactionsQuery extends PageQuery {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE_RE, { message: `from ${DATE_MSG}` }) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE_RE, { message: `to ${DATE_MSG}` }) to?: string;
  @ApiPropertyOptional({ enum: ['INCOME', 'EXPENSE', 'TRANSFER_IN', 'TRANSFER_OUT', 'CARD_PAYMENT'] })
  @IsOptional() @IsIn(['INCOME', 'EXPENSE', 'TRANSFER_IN', 'TRANSFER_OUT', 'CARD_PAYMENT']) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() memberId?: string;
  @ApiPropertyOptional({ enum: ['MANUAL', 'PDF_IMPORT', 'RECEIPT_OCR', 'RECURRENCE'] }) @IsOptional() @IsIn(['MANUAL', 'PDF_IMPORT', 'RECEIPT_OCR', 'RECURRENCE']) source?: string;
  @ApiPropertyOptional({ description: 'Busca na descrição' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}
