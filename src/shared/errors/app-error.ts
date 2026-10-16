/**
 * Erro de domínio com status HTTP explícito.
 * Lançado pelos módulos; convertido em resposta pelo error handler global.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
