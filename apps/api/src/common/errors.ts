import { HttpException } from '@nestjs/common';

export interface FieldError {
  field: string;
  message: string;
}

/** Erro de domínio com código estável, convertido em Problem Details (RFC 9457). */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message, status);
  }
}

export const Errors = {
  validation: (errors: FieldError[], msg = 'Dados inválidos') => new AppError(400, 'VALIDATION_ERROR', msg, { errors }),
  badRequest: (code: string, msg: string) => new AppError(400, code, msg),
  unauthorized: (code = 'UNAUTHORIZED', msg = 'Autenticação necessária') => new AppError(401, code, msg),
  forbidden: (msg = 'Você não tem permissão para esta ação', code = 'FAMILY_PERMISSION_DENIED') => new AppError(403, code, msg),
  // 404 também para recurso de outra família: não revela existência
  notFound: (entity = 'Recurso') => new AppError(404, 'NOT_FOUND', `${entity} não encontrado(a)`),
  conflict: (code: string, msg: string, extra: Record<string, unknown> = {}) => new AppError(409, code, msg, extra),
  unprocessable: (code: string, msg: string) => new AppError(422, code, msg),
  locked: (msg: string) => new AppError(423, 'ACCOUNT_LOCKED', msg),
};
