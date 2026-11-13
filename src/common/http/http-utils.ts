import { RequestWithTraceId } from './request.types';
import { AppError } from '../errors/app-error';

export const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function requireIdempotencyKey(raw: string | undefined): string {
  if (!raw || !UUID_RE.test(raw)) {
    throw AppError.validation('Idempotency-Key header (UUID) is required', [
      { field: 'Idempotency-Key', code: 'invalid', message: 'must be a UUID' },
    ]);
  }
  return raw;
}

export function requireExpectedVersion(raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isInteger(n) || n < 1) {
    throw AppError.validation('X-Expected-Version header (positive integer) is required', [
      { field: 'X-Expected-Version', code: 'invalid', message: 'must be a positive integer' },
    ]);
  }
  return n;
}

export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function parseSize(raw: string | undefined): number {
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1) return Math.min(n, 100);
  return 20;
}

export function parseEnum<T extends Record<string, string>>(
  enumObj: T,
  raw: string | undefined,
): T[keyof T] | undefined {
  if (!raw) return undefined;
  const values = Object.values(enumObj) as string[];
  return values.find((v) => v === raw) as T[keyof T] | undefined;
}

export function envelope(
  req: RequestWithTraceId,
  data: unknown,
): { data: unknown; meta: { traceId: string } } {
  return { data, meta: { traceId: req.traceId ?? 'unknown' } };
}
