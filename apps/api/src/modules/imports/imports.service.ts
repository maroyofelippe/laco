import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit.service';
import type { FamilyContext, RequestMeta } from '../../common/context';
import { Errors } from '../../common/errors';
import { StorageService } from '../../common/storage.service';
import { addDays, newId, normalizeDescription, sha256, today, toCents } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import { fingerprint, TransactionsService, type TxInput } from '../transactions/transactions.service';
import { CategorySuggester } from './category-suggester';
import { extractPdf, PdfPasswordError } from './parsers/pdf-text';
import { pickParser } from './parsers/registry';
import type { SourceType } from './parsers/types';
import { jaroWinkler, rulePattern } from './similarity';

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const DUP_CERTAIN = 1;
const DUP_PROBABLE = 0.85;
const DUP_CHECK = 0.6;

export interface ItemEdit {
  itemId: string;
  decision?: 'ACCEPT' | 'SKIP';
  description?: string;
  amount?: string;
  occurredOn?: string;
  type?: 'INCOME' | 'EXPENSE';
  categoryId?: string;
}

/**
 * Importação de extratos: o arquivo é guardado, o texto é extraído e interpretado, e cada linha
 * vira um RASCUNHO (import_items). Nada entra em `transactions` sem a confirmação do usuário.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger('Imports');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly vis: VisibilityService,
    private readonly txs: TransactionsService,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: FamilyContext, input: { buffer: Buffer; originalName: string; sourceType: SourceType; targetAccountId?: string; targetCardId?: string; password?: string }, meta: RequestMeta) {
    const { sourceType } = input;
    if (sourceType === 'CARD_STATEMENT') {
      if (!input.targetCardId || input.targetAccountId) throw Errors.validation([{ field: 'targetCardId', message: 'fatura de cartão exige targetCardId' }]);
      await this.vis.assertCard(ctx, input.targetCardId, true);
    } else {
      if (!input.targetAccountId || input.targetCardId) throw Errors.validation([{ field: 'targetAccountId', message: 'extrato de conta exige targetAccountId' }]);
      await this.vis.assertAccount(ctx, input.targetAccountId, true);
    }

    // Extrai antes de gravar: PDF com senha não é armazenado até a senha correta chegar
    let doc;
    try {
      doc = await extractPdf(input.buffer, input.password);
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        throw e.reason === 'REQUIRED'
          ? Errors.unprocessable('PDF_PASSWORD_REQUIRED', 'Este PDF é protegido por senha. Informe a senha do arquivo (ela não é guardada).')
          : Errors.unprocessable('PDF_PASSWORD_INVALID', 'A senha do PDF não confere. Tente novamente.');
      }
      throw Errors.unprocessable('PDF_UNREADABLE', 'Não conseguimos abrir este PDF. Verifique se o arquivo não está corrompido.');
    }

    const hash = sha256(input.buffer);
    const previous = await this.db
      .selectFrom('import_batches as b')
      .innerJoin('files as f', 'f.id', 'b.file_id')
      .select(['b.id', 'b.created_at', 'b.status'])
      .where('b.family_id', '=', ctx.familyId)
      .where('f.sha256', '=', hash)
      .where('b.status', '=', 'CONFIRMED')
      .orderBy('b.created_at', 'desc')
      .executeTakeFirst();

    const fileId = newId();
    const batchId = newId();
    const key = `families/${ctx.familyId}/statements/${fileId}.pdf`;
    await this.storage.put(key, input.buffer);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('files')
        .values({ id: fileId, family_id: ctx.familyId, kind: 'STATEMENT_PDF', storage_bucket: this.storage.bucket, storage_key: key, original_name: input.originalName.slice(0, 255), mime_type: 'application/pdf', size_bytes: input.buffer.length, sha256: hash, status: 'STORED', uploaded_by: ctx.userId, retention_until: addDays(today(), 90) })
        .execute();
      await trx
        .insertInto('import_batches')
        .values({ id: batchId, family_id: ctx.familyId, file_id: fileId, source_type: sourceType, target_account_id: input.targetAccountId ?? null, target_card_id: input.targetCardId ?? null, status: 'PROCESSING', created_by: ctx.userId })
        .execute();
    });

    const finish = async (status: 'REVIEW' | 'FAILED', patch: { failure_reason?: string; parser_used?: string; detected_bank?: string | null; stats?: Record<string, unknown> }) => {
      await this.db
        .updateTable('import_batches')
        .set({ status, failure_reason: patch.failure_reason ?? null, parser_used: patch.parser_used ?? null, detected_bank: patch.detected_bank ?? null, stats: patch.stats ? JSON.stringify(patch.stats) : null })
        .where('id', '=', batchId)
        .execute();
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: `import.${status === 'REVIEW' ? 'parsed' : 'failed'}`, entityType: 'import_batch', entityId: batchId, diff: { sourceType, ...patch }, meta });
    };

    if (doc.looksScanned) {
      await finish('FAILED', { failure_reason: 'O PDF parece ser uma imagem digitalizada. Ainda não lemos esse tipo de arquivo; cadastre os lançamentos manualmente.' });
      return this.get(ctx, batchId);
    }

    const parseCtx = { sourceType, today: today() };
    const parser = pickParser(doc, parseCtx);
    const parsed = parser.parse(doc, parseCtx).filter((p) => p.occurredOn && p.amount && toCents(p.amount) > 0);
    const candidateLines = doc.lines.filter((l) => /^\d{2}[/.-]\d{2}/.test(l.text) || /^\d{2}\s+[A-Z]{3}\b/i.test(l.text)).length;
    if (!parsed.length || (candidateLines >= 4 && parsed.length / candidateLines < 0.5 && parsed.length < 3)) {
      await finish('FAILED', { parser_used: parser.id, failure_reason: 'Não reconhecemos lançamentos neste PDF. Você pode cadastrá-los manualmente.' });
      return this.get(ctx, batchId);
    }

    const suggester = await CategorySuggester.load(this.db, ctx.familyId);
    const means = { accountId: input.targetAccountId ?? null, cardId: input.targetCardId ?? null };
    const items = [];
    let duplicates = 0;
    for (const p of parsed) {
      const normalized = normalizeDescription(p.description ?? '');
      const dup = await this.findDuplicate(ctx.familyId, means, { occurredOn: p.occurredOn!, amount: p.amount!, normalized, installmentHint: p.installmentHint });
      if (dup && dup.score >= DUP_PROBABLE) duplicates++;
      items.push({
        id: newId(), family_id: ctx.familyId, batch_id: batchId, line_no: p.lineNo, raw_text: p.raw, occurred_on: p.occurredOn, description: p.description?.slice(0, 200) ?? null,
        normalized_description: normalized || null, amount: p.amount, type: p.type, installment_hint: p.installmentHint,
        suggested_category_id: suggester.suggest(normalized, p.type), confidence: p.confidence,
        duplicate_of_tx_id: dup && dup.score >= DUP_CHECK ? dup.id : null, duplicate_score: dup && dup.score >= DUP_CHECK ? Math.round(dup.score * 1000) / 1000 : null,
        duplicate_reason: dup && dup.score >= DUP_CHECK ? dup.reason : null,
        // Provável duplicata entra desmarcada; o resto já vem marcado para importar
        decision: (dup && dup.score >= DUP_PROBABLE ? 'SKIP' : 'ACCEPT') as 'SKIP' | 'ACCEPT',
      });
    }
    await this.db.insertInto('import_items').values(items).execute();
    const total = items.reduce((s, i) => s + (i.type === 'EXPENSE' ? toCents(i.amount!) : -toCents(i.amount!)), 0);
    await finish('REVIEW', {
      parser_used: parser.id, detected_bank: parser.bank,
      stats: { items: items.length, probableDuplicates: duplicates, withCategory: items.filter((i) => i.suggested_category_id).length, avgConfidence: Math.round((items.reduce((s, i) => s + Number(i.confidence), 0) / items.length) * 100) / 100, netCents: total, alreadyImportedAt: previous?.created_at ?? null },
    });
    return this.get(ctx, batchId);
  }

  /** Duplicata exata (impressão digital) ou provável (mesmo meio e valor, data ±3 dias, descrição parecida). */
  private async findDuplicate(familyId: string, means: { accountId: string | null; cardId: string | null }, p: { occurredOn: string; amount: string; normalized: string; installmentHint: string | null }) {
    const installment = p.installmentHint ? Number(p.installmentHint.split('/')[0]) : null;
    const fp = fingerprint({ family_id: familyId, account_id: means.accountId, card_id: means.cardId, occurred_on: p.occurredOn, amount: p.amount, normalized_description: p.normalized, installment_number: installment });
    const exact = await this.db.selectFrom('transactions').select('id').where('family_id', '=', familyId).where('fingerprint', '=', fp).where('deleted_at', 'is', null).executeTakeFirst();
    if (exact) return { id: exact.id, score: DUP_CERTAIN, reason: 'EXACT' };
    let q = this.db
      .selectFrom('transactions')
      .select(['id', 'occurred_on', 'normalized_description'])
      .where('family_id', '=', familyId)
      .where('deleted_at', 'is', null)
      .where('amount', '=', p.amount)
      .where('occurred_on', '>=', addDays(p.occurredOn, -3))
      .where('occurred_on', '<=', addDays(p.occurredOn, 3));
    q = means.cardId ? q.where('card_id', '=', means.cardId) : q.where('account_id', '=', means.accountId!);
    let best: { id: string; score: number; reason: string } | null = null;
    for (const c of await q.limit(20).execute()) {
      const days = Math.abs((Date.parse(c.occurred_on) - Date.parse(p.occurredOn)) / 86_400_000);
      const score = 0.5 * (1 - days / 4) + 0.5 * jaroWinkler(c.normalized_description, p.normalized);
      if (!best || score > best.score) best = { id: c.id, score, reason: 'SIMILAR' };
    }
    return best;
  }

  async list(ctx: FamilyContext, limit = 30) {
    const rows = await this.db
      .selectFrom('import_batches as b')
      .innerJoin('files as f', 'f.id', 'b.file_id')
      .select(['b.id', 'b.source_type', 'b.status', 'b.failure_reason', 'b.stats', 'b.created_at', 'b.confirmed_at', 'b.target_account_id', 'b.target_card_id', 'f.original_name'])
      .where('b.family_id', '=', ctx.familyId)
      .orderBy('b.created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((b) => ({ id: b.id, sourceType: b.source_type, status: b.status, failureReason: b.failure_reason, stats: b.stats, fileName: b.original_name, targetAccountId: b.target_account_id, targetCardId: b.target_card_id, createdAt: b.created_at, confirmedAt: b.confirmed_at }));
  }

  async get(ctx: FamilyContext, id: string) {
    const b = await this.batch(ctx, id);
    const items = await this.db
      .selectFrom('import_items as i')
      .leftJoin('categories as c', 'c.id', 'i.suggested_category_id')
      .leftJoin('transactions as t', 't.id', 'i.duplicate_of_tx_id')
      .select(['i.id', 'i.line_no', 'i.raw_text', 'i.occurred_on', 'i.description', 'i.amount', 'i.type', 'i.installment_hint', 'i.suggested_category_id', 'c.name as category_name', 'i.confidence', 'i.duplicate_of_tx_id', 'i.duplicate_score', 'i.duplicate_reason', 'i.decision', 'i.created_tx_id', 't.description as dup_description', 't.occurred_on as dup_date', 't.amount as dup_amount'])
      .where('i.family_id', '=', ctx.familyId)
      .where('i.batch_id', '=', id)
      .orderBy('i.line_no')
      .execute();
    const file = await this.db.selectFrom('files').select(['original_name']).where('id', '=', b.file_id).executeTakeFirstOrThrow();
    return {
      id: b.id, sourceType: b.source_type, status: b.status, failureReason: b.failure_reason, parser: b.parser_used, detectedBank: b.detected_bank, stats: b.stats,
      fileName: file.original_name, targetAccountId: b.target_account_id, targetCardId: b.target_card_id, createdAt: b.created_at, confirmedAt: b.confirmed_at,
      items: items.map((i) => ({
        id: i.id, lineNo: i.line_no, rawText: i.raw_text, occurredOn: i.occurred_on, description: i.description, amount: i.amount, type: i.type, installmentHint: i.installment_hint,
        categoryId: i.suggested_category_id, categoryName: i.category_name, confidence: Number(i.confidence), decision: i.decision, createdTransactionId: i.created_tx_id,
        duplicate: i.duplicate_of_tx_id ? { transactionId: i.duplicate_of_tx_id, score: Number(i.duplicate_score), reason: i.duplicate_reason, level: Number(i.duplicate_score) >= DUP_PROBABLE ? 'PROBABLE' : 'CHECK', description: i.dup_description, occurredOn: i.dup_date, amount: i.dup_amount } : null,
      })),
    };
  }

  async editItem(ctx: FamilyContext, batchId: string, edit: ItemEdit) {
    const b = await this.batch(ctx, batchId);
    if (b.status !== 'REVIEW') throw Errors.unprocessable('IMPORT_NOT_IN_REVIEW', 'Esta importação não está mais em revisão.');
    await this.applyEdits(this.db, ctx, batchId, [edit]);
    return (await this.get(ctx, batchId)).items.find((i) => i.id === edit.itemId);
  }

  private async applyEdits(trx: Db, ctx: FamilyContext, batchId: string, edits: ItemEdit[]) {
    for (const e of edits) {
      if (e.categoryId) {
        const c = await trx.selectFrom('categories').select('id').where('family_id', '=', ctx.familyId).where('id', '=', e.categoryId).executeTakeFirst();
        if (!c) throw Errors.unprocessable('INVALID_REFERENCE', 'Categoria inexistente nesta família.');
      }
      const r = await trx
        .updateTable('import_items')
        .set({
          ...(e.decision ? { decision: e.decision } : {}),
          // normalized_description guarda o texto ORIGINAL do banco (base das regras aprendidas)
          ...(e.description !== undefined ? { description: e.description.trim().slice(0, 200) } : {}),
          ...(e.amount ? { amount: e.amount } : {}),
          ...(e.occurredOn ? { occurred_on: e.occurredOn } : {}),
          ...(e.type ? { type: e.type } : {}),
          ...(e.categoryId ? { suggested_category_id: e.categoryId } : {}),
        })
        .where('family_id', '=', ctx.familyId)
        .where('batch_id', '=', batchId)
        .where('id', '=', e.itemId)
        .executeTakeFirst();
      if (Number(r.numUpdatedRows) === 0) {
        const exists = await trx.selectFrom('import_items').select('id').where('batch_id', '=', batchId).where('id', '=', e.itemId).executeTakeFirst();
        if (!exists) throw Errors.notFound('Item da importação');
      }
    }
  }

  /** Confirmação atômica: cria só os itens marcados (com categoria), aprende as categorias escolhidas. */
  async confirm(ctx: FamilyContext, batchId: string, edits: ItemEdit[], meta: RequestMeta) {
    const b = await this.batch(ctx, batchId);
    if (b.status !== 'REVIEW') throw Errors.unprocessable('IMPORT_NOT_IN_REVIEW', 'Esta importação não está mais em revisão.');
    if (edits.length) await this.applyEdits(this.db, ctx, batchId, edits);

    const items = await this.db.selectFrom('import_items').selectAll().where('family_id', '=', ctx.familyId).where('batch_id', '=', batchId).orderBy('line_no').execute();
    const accepted = items.filter((i) => i.decision === 'ACCEPT');
    const problems = accepted.flatMap((i) => {
      const miss: string[] = [];
      if (!i.suggested_category_id) miss.push('categoria');
      if (!i.amount || toCents(i.amount) <= 0) miss.push('valor');
      if (!i.occurred_on) miss.push('data');
      if (!i.type) miss.push('tipo');
      if (!i.description?.trim()) miss.push('descrição');
      return miss.length ? [{ field: `items.${i.id}`, message: `linha ${i.line_no}: falta ${miss.join(', ')}` }] : [];
    });
    if (problems.length) throw Errors.validation(problems, 'Revise os itens marcados antes de confirmar');

    const inputs: TxInput[] = accepted.map((i) => ({
      type: i.type!, amount: i.amount!, description: i.description!, categoryId: i.suggested_category_id!, occurredOn: i.occurred_on!,
      accountId: b.target_account_id, cardId: b.target_card_id, source: 'PDF_IMPORT', importItemId: i.id,
    }));
    const created = await this.txs.insertMany(ctx, inputs, meta, {
      action: 'import.confirm', entityType: 'import_batch', entityId: batchId,
      onInserted: async (trx, rows) => {
        for (const r of rows) await trx.updateTable('import_items').set({ created_tx_id: r.id }).where('id', '=', r.import_item_id!).execute();
        await trx.updateTable('import_batches').set({ status: 'CONFIRMED', confirmed_at: sql`NOW(3)` as never }).where('id', '=', batchId).execute();
        // Aprende: texto original do banco (o que virá de novo no próximo extrato) e o texto final → categoria
        const original = new Map(accepted.map((i) => [i.id, i.normalized_description ?? '']));
        for (const r of rows) {
          const patterns = new Set([rulePattern(original.get(r.import_item_id!) ?? ''), rulePattern(r.normalized_description)].filter(Boolean));
          for (const pattern of patterns) {
            await trx
              .insertInto('category_rules')
              .values({ family_id: ctx.familyId, pattern, category_id: r.category_id })
              .onDuplicateKeyUpdate({ category_id: r.category_id, hits: sql`hits + 1` })
              .execute();
          }
        }
      },
    });
    if (!accepted.length) {
      await this.db.updateTable('import_batches').set({ status: 'CONFIRMED', confirmed_at: sql`NOW(3)` as never }).where('id', '=', batchId).execute();
    }
    return {
      batchId, status: 'CONFIRMED', created: created.ids.length, skipped: items.length - accepted.length,
      duplicatesSkipped: items.filter((i) => i.decision === 'SKIP' && i.duplicate_of_tx_id && Number(i.duplicate_score) >= DUP_PROBABLE).length,
      alertsTriggered: created.alerts.length,
    };
  }

  async cancel(ctx: FamilyContext, batchId: string, meta: RequestMeta) {
    const b = await this.batch(ctx, batchId);
    if (b.status === 'CONFIRMED') throw Errors.unprocessable('IMPORT_ALREADY_CONFIRMED', 'Esta importação já foi confirmada. Exclua os lançamentos, se precisar.');
    await this.db.updateTable('import_batches').set({ status: 'CANCELLED' }).where('id', '=', batchId).execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'import.cancel', entityType: 'import_batch', entityId: batchId, meta });
  }

  private async batch(ctx: FamilyContext, id: string) {
    const b = await this.db.selectFrom('import_batches').selectAll().where('family_id', '=', ctx.familyId).where('id', '=', id).executeTakeFirst();
    if (!b) throw Errors.notFound('Importação');
    // Só quem enxerga a conta/cartão de destino vê a importação
    if (b.target_account_id) await this.vis.assertAccount(ctx, b.target_account_id);
    if (b.target_card_id) await this.vis.assertCard(ctx, b.target_card_id);
    return b;
  }
}
