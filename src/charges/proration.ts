import Decimal from 'decimal.js';

const DAY_MS = 86_400_000;

export interface ProratableComponent {
  kind: string;
  name: string;
  amount: number;
  deductibleOnAbsence: boolean;
}

export interface ProratedComponent {
  kind: string;
  name: string;
  amount: number;
  deductibleOnAbsence: boolean;
}

/** Parses a strict YYYY-MM-DD (assumed already validated) to a UTC-midnight Date. */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Number of whole days in the half-open interval [start, end). */
export function daysBetweenExclusive(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/** Calendar days in the month containing `date`. */
export function daysInMonth(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** First day of the month containing `date`. */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** First day of the month after the month containing `date`. */
export function nextMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/**
 * Prorated amount for one component: `amount × occupiedDays / calendarDays`,
 * rounded HALF_UP to an integer Afghani. A full month returns the full amount
 * exactly. Pure; never uses Float/Double for money math (decimal.js handles the
 * intermediate rational before rounding).
 */
export function prorate(amount: number, occupiedDays: number, calendarDays: number): number {
  if (occupiedDays <= 0 || amount <= 0) return 0;
  if (occupiedDays >= calendarDays) return amount;
  return new Decimal(amount)
    .mul(occupiedDays)
    .div(calendarDays)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** Prorates every component independently and returns rounded amounts (total = sum of parts). */
export function prorateComponents(
  components: ProratableComponent[],
  occupiedDays: number,
  calendarDays: number,
): { total: number; components: ProratedComponent[] } {
  const rounded = components.map((c) => ({
    ...c,
    amount: prorate(c.amount, occupiedDays, calendarDays),
  }));
  const total = rounded.reduce((acc, c) => acc + c.amount, 0);
  return { total, components: rounded };
}

/**
 * True when [start, end) is exactly one canonical calendar month: `start` is
 * the first day of a month and `end` is the first day of the next month.
 *
 * Billing is monthly in the MVP (F-23), so a BillingRun period must satisfy
 * this shape. Multi-month or non-calendar boundaries are rejected rather than
 * silently billed with a single-month formula.
 */
export function isCanonicalBillingMonth(start: Date, end: Date): boolean {
  const s = monthStart(start);
  return start.getTime() === s.getTime() && end.getTime() === nextMonthStart(s).getTime();
}

/** Splits a half-open interval across calendar-month boundaries (for multi-month absence credits). */
export function splitIntoMonths(
  start: Date,
  end: Date,
): Array<{ periodStart: Date; periodEnd: Date }> {
  const periods: Array<{ periodStart: Date; periodEnd: Date }> = [];
  let cursor = monthStart(start);
  while (cursor < end) {
    const n = nextMonthStart(cursor);
    const segStart = cursor > start ? cursor : start;
    const segEnd = n < end ? n : end;
    if (segEnd > segStart) periods.push({ periodStart: segStart, periodEnd: segEnd });
    cursor = n;
  }
  return periods;
}
