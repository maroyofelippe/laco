import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuditService } from '../../common/audit.service';
import { atLeast, Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { Errors } from '../../common/errors';
import { sniffMime, StorageService } from '../../common/storage.service';
import { newId, sha256 } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';

const MAX_IMAGE = 8 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

@ApiTags('Arquivos')
@ApiBearerAuth()
@Controller('families/:familyId')
export class FilesController {
  constructor(@InjectDb() private readonly db: Db, private readonly storage: StorageService, private readonly vis: VisibilityService, private readonly audit: AuditService) {}

  @Post('transactions/:id/attachments')
  @MinRole('MEMBER')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Anexa a foto de uma nota fiscal/comprovante ao lançamento (JPEG, PNG ou WebP, até 8 MB)' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE, files: 1 } }))
  async attach(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) txId: string, @UploadedFile() file: Express.Multer.File | undefined, @Meta() meta: RequestMeta) {
    const tx = await this.visibleTx(ctx, txId);
    if (!atLeast(ctx.role, 'ADMIN') && tx.created_by !== ctx.userId && tx.member_user_id !== ctx.userId) throw Errors.forbidden('Você só pode anexar arquivos aos seus próprios lançamentos.');
    if (!file) throw Errors.validation([{ field: 'file', message: 'envie a imagem no campo "file"' }]);
    const mime = sniffMime(file.buffer);
    if (!mime || !mime.startsWith('image/')) throw Errors.unprocessable('UNSUPPORTED_FILE', 'Envie uma foto em JPEG, PNG ou WebP.');
    const id = newId();
    const key = `families/${ctx.familyId}/receipts/${id}.${EXT[mime]}`;
    await this.storage.put(key, file.buffer);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('files')
        .values({ id, family_id: ctx.familyId, kind: 'RECEIPT_IMAGE', storage_bucket: this.storage.bucket, storage_key: key, original_name: (file.originalname || 'nota').slice(0, 255), mime_type: mime, size_bytes: file.size, sha256: sha256(file.buffer), status: 'STORED', uploaded_by: ctx.userId })
        .execute();
      await trx.insertInto('transaction_attachments').values({ transaction_id: txId, file_id: id, family_id: ctx.familyId }).execute();
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'attachment.create', entityType: 'transaction', entityId: txId, diff: { fileId: id, mime, size: file.size }, meta }, trx);
    });
    return { id, mimeType: mime, sizeBytes: file.size, url: `/families/${ctx.familyId}/files/${id}/content` };
  }

  @Get('transactions/:id/attachments')
  async list(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) txId: string) {
    await this.visibleTx(ctx, txId);
    const rows = await this.db
      .selectFrom('transaction_attachments as a')
      .innerJoin('files as f', 'f.id', 'a.file_id')
      .select(['f.id', 'f.mime_type', 'f.size_bytes', 'f.created_at'])
      .where('a.family_id', '=', ctx.familyId)
      .where('a.transaction_id', '=', txId)
      .where('f.status', '=', 'STORED')
      .execute();
    return rows.map((r) => ({ id: r.id, mimeType: r.mime_type, sizeBytes: r.size_bytes, createdAt: r.created_at, url: `/families/${ctx.familyId}/files/${r.id}/content` }));
  }

  @Get('files/:fileId/content')
  @ApiOperation({ summary: 'Baixa um arquivo da família (sempre via API, com autorização)' })
  async content(@Family() ctx: FamilyContext, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    const f = await this.db.selectFrom('files').selectAll().where('family_id', '=', ctx.familyId).where('id', '=', fileId).where('status', '=', 'STORED').executeTakeFirst();
    if (!f) throw Errors.notFound('Arquivo');
    // Anexo de lançamento: aplica a visibilidade da conta/cartão do lançamento
    const link = await this.db.selectFrom('transaction_attachments').select('transaction_id').where('file_id', '=', fileId).executeTakeFirst();
    if (link) await this.visibleTx(ctx, link.transaction_id);
    if (!this.storage.exists(f.storage_key)) throw Errors.notFound('Arquivo');
    res.setHeader('Content-Type', f.mime_type);
    res.setHeader('Content-Length', String(f.size_bytes));
    res.setHeader('Content-Disposition', `inline; filename="${f.id}.${EXT[f.mime_type] ?? 'bin'}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage.read(f.storage_key).pipe(res);
  }

  @Delete('transactions/:id/attachments/:fileId')
  @MinRole('MEMBER')
  @HttpCode(204)
  async remove(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) txId: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Meta() meta: RequestMeta) {
    const tx = await this.visibleTx(ctx, txId);
    if (!atLeast(ctx.role, 'ADMIN') && tx.created_by !== ctx.userId && tx.member_user_id !== ctx.userId) throw Errors.forbidden('Você só pode remover anexos dos seus próprios lançamentos.');
    const r = await this.db.deleteFrom('transaction_attachments').where('family_id', '=', ctx.familyId).where('transaction_id', '=', txId).where('file_id', '=', fileId).executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) throw Errors.notFound('Anexo');
    const f = await this.db.selectFrom('files').select('storage_key').where('id', '=', fileId).executeTakeFirstOrThrow();
    await this.db.updateTable('files').set({ status: 'DELETED' }).where('id', '=', fileId).execute();
    await this.storage.remove(f.storage_key);
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'attachment.delete', entityType: 'transaction', entityId: txId, diff: { fileId }, meta });
  }

  private async visibleTx(ctx: FamilyContext, id: string) {
    const t = await this.db.selectFrom('transactions').selectAll().where('family_id', '=', ctx.familyId).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw Errors.notFound('Lançamento');
    if (!this.vis.seesAll(ctx)) {
      const accs = await this.vis.visibleAccountIds(ctx);
      const cards = await this.vis.visibleCardIds(ctx);
      if ((t.account_id && accs && !accs.includes(t.account_id)) || (t.card_id && cards && !cards.includes(t.card_id))) throw Errors.notFound('Lançamento');
    }
    return t;
  }
}
