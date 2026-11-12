import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

const REASON_PHRASES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

export class AppError extends HttpException {
  readonly code: ErrorCode;
  readonly errors?: FieldError[];

  constructor(
    code: ErrorCode,
    status: number,
    detail: string,
    options: { type?: string; errors?: FieldError[] } = {},
  ) {
    super(
      {
        type: options.type ?? 'about:blank',
        title: REASON_PHRASES[status] ?? 'Error',
        status,
        detail,
        code,
        ...(options.errors ? { errors: options.errors } : {}),
      },
      status,
    );
    this.code = code;
    this.errors = options.errors;
    // Keep `Error.message` aligned with the human-readable `detail` so callers
    // and test assertions see the real reason, not the class-name-derived
    // "App Error" that NestJS's HttpException.initMessage() would produce.
    this.message = detail;
  }

  static unauthorized(
    detail = 'Authentication required',
    code: ErrorCode = ErrorCode.UNAUTHENTICATED,
  ): AppError {
    return new AppError(code, HttpStatus.UNAUTHORIZED, detail);
  }

  static forbidden(detail = 'Forbidden', code: ErrorCode = ErrorCode.FORBIDDEN): AppError {
    return new AppError(code, HttpStatus.FORBIDDEN, detail);
  }

  static notFound(detail = 'Resource not found'): AppError {
    return new AppError(ErrorCode.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND, detail);
  }

  static badRequest(
    detail = 'Bad request',
    code: ErrorCode = ErrorCode.VALIDATION_ERROR,
  ): AppError {
    return new AppError(code, HttpStatus.BAD_REQUEST, detail);
  }

  static conflict(detail: string, code: ErrorCode = ErrorCode.BUSINESS_RULE_VIOLATION): AppError {
    return new AppError(code, HttpStatus.CONFLICT, detail);
  }

  static validation(detail: string, errors: FieldError[]): AppError {
    return new AppError(ErrorCode.VALIDATION_ERROR, HttpStatus.UNPROCESSABLE_ENTITY, detail, {
      errors,
    });
  }

  static rateLimited(detail = 'Too many requests'): AppError {
    return new AppError(ErrorCode.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS, detail);
  }

  static internal(detail = 'Internal server error'): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, HttpStatus.INTERNAL_SERVER_ERROR, detail);
  }
}
