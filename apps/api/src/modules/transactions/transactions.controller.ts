import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { CreateInstallmentsDto, CreateTransactionDto, CreateTransferDto, ListTransactionsQuery, ScopeQuery, UpdateTransactionDto } from './transactions.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('Lançamentos')
@ApiBearerAuth()
@ApiHeader({ name: 'Idempotency-Key', required: false, description: 'UUID para reenvio seguro (app offline)' })
@Controller('families/:familyId/transactions')
export class TransactionsController {
  constructor(private readonly svc: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista com filtros, busca e paginação por cursor; inclui totais do filtro' })
  list(@Family() ctx: FamilyContext, @Query() q: ListTransactionsQuery) {
    return this.svc.list(ctx, q);
  }

  @Post()
  @MinRole('MEMBER')
  @ApiOperation({ summary: 'Cria receita ou despesa (categoria obrigatória)' })
  create(@Family() ctx: FamilyContext, @Body() dto: CreateTransactionDto, @Meta() meta: RequestMeta) {
    return this.svc.create(ctx, dto, meta);
  }

  @Post('installments')
  @MinRole('MEMBER')
  @ApiOperation({ summary: 'Compra parcelada: gera N lançamentos, um por mês' })
  installments(@Family() ctx: FamilyContext, @Body() dto: CreateInstallmentsDto, @Meta() meta: RequestMeta) {
    return this.svc.createInstallments(ctx, dto, meta);
  }

  @Post('transfers')
  @MinRole('MEMBER')
  @ApiOperation({ summary: 'Transferência entre contas (dois lançamentos ligados)' })
  transfer(@Family() ctx: FamilyContext, @Body() dto: CreateTransferDto, @Meta() meta: RequestMeta) {
    return this.svc.createTransfer(ctx, dto, meta);
  }

  @Get(':id')
  get(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Patch(':id')
  @MinRole('MEMBER')
  @ApiHeader({ name: 'If-Match', required: true, description: 'Versão atual do lançamento (concorrência otimista)' })
  update(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTransactionDto, @Query() q: ScopeQuery, @Headers('if-match') ifMatch: string | undefined, @Meta() meta: RequestMeta) {
    return this.svc.update(ctx, id, dto, ifMatch, q.scope ?? 'this', meta);
  }

  @Delete(':id')
  @MinRole('MEMBER')
  remove(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: ScopeQuery, @Meta() meta: RequestMeta) {
    return this.svc.remove(ctx, id, q.scope ?? 'this', meta);
  }
}
