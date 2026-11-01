import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { config } from '../config';
import { AppError } from './errors';

const TITLES: Record<number, string> = {
  400: 'Requisição inválida', 401: 'Não autenticado', 403: 'Acesso negado', 404: 'Não encontrado',
  409: 'Conflito', 412: 'Pré-condição falhou', 422: 'Regra de negócio violada', 423: 'Bloqueado',
  428: 'Pré-condição obrigatória', 429: 'Muitas requisições', 500: 'Erro interno',
};

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR',
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = String(req.id ?? '');

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let detail = 'Ocorreu um erro inesperado. Tente novamente.';
    let extra: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      detail = exception.message;
      extra = exception.extra;
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      code = 'RATE_LIMITED';
      detail = 'Limite de requisições excedido. Aguarde e tente novamente.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = DEFAULT_CODES[status] ?? `HTTP_${status}`;
      const body = exception.getResponse();
      detail = typeof body === 'string' ? body : ((body as { message?: string }).message ?? exception.message);
      if (Array.isArray(detail)) detail = detail.join('; ');
    } else if (isMysqlError(exception)) {
      ({ status, code, detail } = mapMysqlError(exception));
    }

    if (status >= 500) this.logger.error({ err: exception, requestId }, 'Erro não tratado');

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: `${config.problemTypeBase}${code.toLowerCase().replace(/_/g, '-')}`,
        title: TITLES[status] ?? 'Erro',
        status,
        code,
        detail,
        instance: req.originalUrl,
        requestId,
        ...extra,
      });
  }
}

function isMysqlError(e: unknown): e is { code: string; errno: number; sqlMessage?: string } {
  return typeof e === 'object' && e !== null && 'errno' in e && 'code' in e;
}

function mapMysqlError(e: { code: string; errno: number; sqlMessage?: string }) {
  switch (e.code) {
    case 'ER_DUP_ENTRY':
      return { status: 409, code: 'DUPLICATE', detail: 'Já existe um registro com esses dados.' };
    case 'ER_NO_REFERENCED_ROW_2':
    case 'ER_NO_REFERENCED_ROW':
      // Inclui tentativa de referenciar recurso de outra família (FK composta)
      return { status: 422, code: 'INVALID_REFERENCE', detail: 'Referência inválida para esta família.' };
    case 'ER_ROW_IS_REFERENCED_2':
      return { status: 409, code: 'IN_USE', detail: 'Registro em uso por outros dados.' };
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return { status: 422, code: 'CONSTRAINT_VIOLATION', detail: 'Os dados violam uma regra de integridade.' };
    default:
      return { status: 500, code: 'INTERNAL_ERROR', detail: 'Ocorreu um erro inesperado. Tente novamente.' };
  }
}
