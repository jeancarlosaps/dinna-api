import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../errors/app-error.js';

/** Formato único de erro da API: { error: { code, message, details? } } */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } } satisfies ErrorBody);
    }

    if (error.validation) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: error.message, details: error.validation },
      } satisfies ErrorBody);
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(error);
      return reply
        .status(500)
        .send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } } satisfies ErrorBody);
    }

    return reply.status(statusCode).send({
      error: { code: error.code ?? 'REQUEST_ERROR', message: error.message },
    } satisfies ErrorBody);
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Rota ${request.method} ${request.url} não encontrada` },
    } satisfies ErrorBody);
  });
}
