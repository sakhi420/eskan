import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { RequestWithTraceId } from '../http/request.types';

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

function codeFor(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.RESOURCE_NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCode.RESOURCE_VERSION_CONFLICT;
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ErrorCode.VALIDATION_ERROR;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithTraceId>();
    const traceId = request.traceId ?? 'unknown';
    const instance = request.originalUrl ?? request.url;

    if (exception instanceof AppError) {
      const status = exception.getStatus();
      const payload = exception.getResponse() as Record<string, unknown>;
      response.status(status).json({ ...payload, traceId, instance });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      let detail = REASONS[status] ?? 'Error';
      let errors: Record<string, unknown>[] | undefined;

      if (typeof raw === 'object' && raw !== null) {
        const r = raw as { message?: string | string[] };
        if (Array.isArray(r.message)) {
          detail = 'Request validation failed';
          errors = r.message.map((m) => ({ field: '', code: 'invalid', message: m }));
        } else if (typeof r.message === 'string') {
          detail = r.message;
        }
      } else if (typeof raw === 'string') {
        detail = raw;
      }

      response.status(status).json({
        type: 'about:blank',
        title: REASONS[status] ?? 'Error',
        status,
        detail,
        code: status === HttpStatus.UNPROCESSABLE_ENTITY ? ErrorCode.VALIDATION_ERROR : codeFor(status),
        traceId,
        instance,
        ...(errors ? { errors } : {}),
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred',
      code: ErrorCode.INTERNAL_ERROR,
      traceId,
      instance,
    });
  }
}