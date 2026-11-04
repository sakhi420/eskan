import { ValidationError } from '@nestjs/common';
import { AppError, FieldError } from '../errors/app-error';

function flatten(errors: ValidationError[], prefix = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const err of errors) {
    const field = prefix ? `${prefix}.${err.property}` : err.property;
    if (err.constraints) {
      const [code, message] = Object.entries(err.constraints)[0] ?? ['invalid', 'invalid value'];
      out.push({ field, code, message });
    }
    if (err.children?.length) {
      out.push(...flatten(err.children, field));
    }
  }
  return out;
}

export function validationExceptionFactory(errors: ValidationError[]): AppError {
  return AppError.validation('Request validation failed', flatten(errors));
}