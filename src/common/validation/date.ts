import { AppError } from '../errors/app-error';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict calendar check for a `YYYY-MM-DD` string (no Date rollover accepted). */
export function isValidDateOnly(value: string): boolean {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const date = new Date(Date.UTC(2000, m - 1, d));
  date.setUTCFullYear(y);
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Parses a strict `YYYY-MM-DD` string into a `Date` at 00:00:00 UTC.
 * Throws a 422 validation error (with field context) when the value is not a
 * real calendar date — e.g. `2026-02-31` is rejected rather than rolled over.
 */
export function parseDateOnly(value: string, field = 'date'): Date {
  if (!isValidDateOnly(value)) {
    throw AppError.validation('Invalid date', [
      { field, code: 'invalid', message: 'must be a valid YYYY-MM-DD date' },
    ]);
  }
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}