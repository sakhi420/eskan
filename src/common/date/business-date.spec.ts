import { exclusiveEndForInclusiveLastDay, isValidDateOnly } from './business-date';

describe('business-date helpers', () => {
  describe('isValidDateOnly', () => {
    it('accepts a valid YYYY-MM-DD', () => {
      expect(isValidDateOnly('2026-02-28')).toBe(true);
    });

    it('rejects a non-existent calendar date', () => {
      expect(isValidDateOnly('2026-02-30')).toBe(false);
      expect(isValidDateOnly('2026-04-31')).toBe(false);
    });

    it('rejects malformed shapes', () => {
      expect(isValidDateOnly('2026-2-8')).toBe(false);
      expect(isValidDateOnly('28-02-2026')).toBe(false);
      expect(isValidDateOnly('not-a-date')).toBe(false);
      expect(isValidDateOnly('')).toBe(false);
    });
  });

  describe('exclusiveEndForInclusiveLastDay', () => {
    it('adds exactly one day', () => {
      expect(exclusiveEndForInclusiveLastDay('2026-11-07')).toBe('2026-11-08');
    });

    it('rolls over a 30-day month', () => {
      expect(exclusiveEndForInclusiveLastDay('2026-06-30')).toBe('2026-07-01');
    });

    it('rolls over a 31-day month', () => {
      expect(exclusiveEndForInclusiveLastDay('2026-01-31')).toBe('2026-02-01');
    });

    it('handles Feb 28 in a non-leap year', () => {
      expect(exclusiveEndForInclusiveLastDay('2026-02-28')).toBe('2026-03-01');
    });

    it('handles Feb 28 in a leap year', () => {
      expect(exclusiveEndForInclusiveLastDay('2024-02-28')).toBe('2024-02-29');
    });

    it('handles Feb 29 (leap day) correctly', () => {
      expect(exclusiveEndForInclusiveLastDay('2024-02-29')).toBe('2024-03-01');
    });

    it('rolls over the end of the year', () => {
      expect(exclusiveEndForInclusiveLastDay('2026-12-31')).toBe('2027-01-01');
    });

    it('throws on an invalid date rather than persisting a wrong end', () => {
      expect(() => exclusiveEndForInclusiveLastDay('2026-02-30')).toThrow();
      expect(() => exclusiveEndForInclusiveLastDay('garbage')).toThrow();
    });
  });
});
