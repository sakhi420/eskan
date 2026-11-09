import {
  daysBetweenExclusive, daysInMonth, isCanonicalBillingMonth, parseDateOnly, prorate, prorateComponents, splitIntoMonths, toISO,
} from './proration';

describe('proration', () => {
  it('full month returns the full amount (no rounding loss)', () => {
    expect(prorate(31000, 31, 31)).toBe(31000);
    expect(prorate(31000, 30, 30)).toBe(31000);
    expect(prorate(31000, 29, 29)).toBe(31000);
    expect(prorate(31000, 28, 28)).toBe(31000);
  });

  it('rounds HALF_UP for partial months', () => {
    expect(prorate(1000, 1, 31)).toBe(32); // 32.258...
    expect(prorate(1, 1, 2)).toBe(1); // 0.5 -> 1 (HALF_UP)
    expect(prorate(3, 1, 2)).toBe(2); // 1.5 -> 2 (HALF_UP)
    expect(prorate(10, 1, 3)).toBe(3); // 3.333 -> 3
    expect(prorate(10, 2, 3)).toBe(7); // 6.667 -> 7
  });

  it('computes calendar days for 28/29/30/31-day months', () => {
    expect(daysInMonth(parseDateOnly('2026-02-01'))).toBe(28);
    expect(daysInMonth(parseDateOnly('2024-02-01'))).toBe(29); // leap year
    expect(daysInMonth(parseDateOnly('2026-04-01'))).toBe(30);
    expect(daysInMonth(parseDateOnly('2026-01-01'))).toBe(31);
  });

  it('rounds each component independently and sums', () => {
    const { total, components } = prorateComponents(
      [
        { kind: 'ACCOMMODATION', name: 'Room', amount: 1000, deductibleOnAbsence: false },
        { kind: 'BOARD', name: 'Food', amount: 700, deductibleOnAbsence: true },
      ],
      15,
      31,
    );
    expect(components[0].amount).toBe(484); // 483.87 -> 484
    expect(components[1].amount).toBe(339); // 338.71 -> 339
    expect(total).toBe(823);
  });

  it('splits a multi-month interval across calendar boundaries', () => {
    const segments = splitIntoMonths(parseDateOnly('2026-01-15'), parseDateOnly('2026-03-10')).map((s) => `${toISO(s.periodStart)}..${toISO(s.periodEnd)}`);
    expect(segments).toEqual(['2026-01-15..2026-02-01', '2026-02-01..2026-03-01', '2026-03-01..2026-03-10']);
  });

  it('counts half-open days (return day excluded)', () => {
    expect(daysBetweenExclusive(parseDateOnly('2026-11-01'), parseDateOnly('2026-11-04'))).toBe(3);
  });

  it('recognizes canonical billing months and rejects non-canonical ones', () => {
    expect(isCanonicalBillingMonth(parseDateOnly('2026-11-01'), parseDateOnly('2026-12-01'))).toBe(true);
    expect(isCanonicalBillingMonth(parseDateOnly('2026-02-01'), parseDateOnly('2026-03-01'))).toBe(true);
    expect(isCanonicalBillingMonth(parseDateOnly('2024-02-01'), parseDateOnly('2024-03-01'))).toBe(true); // leap year
    expect(isCanonicalBillingMonth(parseDateOnly('2026-11-16'), parseDateOnly('2026-12-01'))).toBe(false);
    expect(isCanonicalBillingMonth(parseDateOnly('2026-11-01'), parseDateOnly('2027-01-01'))).toBe(false);
    expect(isCanonicalBillingMonth(parseDateOnly('2026-11-01'), parseDateOnly('2026-11-30'))).toBe(false);
  });
});