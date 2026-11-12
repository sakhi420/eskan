import { Prisma } from '../../generated/prisma/client';

export const DEFAULT_TIMEZONE = 'Asia/Kabul';

/**
 * Today's date ("YYYY-MM-DD") in a named IANA timezone, produced without any
 * `getUTC*`/`toISOString` math so it does not depend on the server's local
 * clock offset. This is the canonical source of the "business date" for the
 * org (check-in/check-out, contract close, assignment end, etc.).
 */
export function businessToday(timezone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const value = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * True when `timezone` is a real IANA timezone name accepted by `Intl`.
 * Used to reject bogus timezone strings before they are persisted, so a later
 * `businessToday()` call cannot blow up with a `RangeError` on a bad value.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The organisation's business today, falling back to the default timezone when
 * the organisation row is missing (or has no explicit timezone). Requires a
 * client with an `organization` delegate, i.e. the main client or an
 * interactive-transaction client.
 */
export async function businessTodayForOrg(
  client: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return businessToday(org?.timezone || DEFAULT_TIMEZONE);
}

/** Converts a "YYYY-MM-DD" business date to a UTC-midnight Date for @db.Date columns. */
export function toDateOnly(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

/**
 * True when `value` is a strict, calendar-valid "YYYY-MM-DD" date. Rejects
 * malformed shapes and non-existent dates such as 2026-02-30. Pure and
 * timezone-independent: validation is performed on the UTC instant of the string.
 */
export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Converts the last inclusive occupied day `D` (a "YYYY-MM-DD" business date)
 * into the exclusive half-open end date `D + 1`, per the domain rule that all
 * date ranges are half-open `[startDate, endDate)`. Uses UTC date-only
 * arithmetic so month/year rollover (including leap years) is correct and the
 * result never depends on the server's local timezone.
 *
 * Throws on an invalid input date rather than silently persisting a wrong end.
 */
export function exclusiveEndForInclusiveLastDay(lastDay: string): string {
  if (!isValidDateOnly(lastDay)) {
    throw new Error(`Invalid date-only value: ${JSON.stringify(lastDay)}`);
  }
  const d = new Date(`${lastDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
