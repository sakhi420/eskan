import { canonicalRequestHash, jcsStringify } from './jcs';

describe('jcsStringify (RFC 8785 JCS)', () => {
  it('sorts object keys by UTF-16 code unit', () => {
    expect(jcsStringify({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
    expect(jcsStringify({ c: 3, a: 2, b: 1 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it('preserves array order', () => {
    expect(jcsStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('escapes control characters and quotes, leaves non-ASCII intact', () => {
    expect(jcsStringify('a\nb\t"c"\\d\u000f')).toBe('"a\\nb\\t\\"c\\"\\\\d\\u000f"');
    expect(jcsStringify('€کابل')).toBe('"€کابل"');
  });

  it('serializes numbers as integers without decimal point and -0 as 0', () => {
    expect(jcsStringify(1234)).toBe('1234');
    expect(jcsStringify(-0)).toBe('0');
    expect(jcsStringify(true)).toBe('true');
    expect(jcsStringify(null)).toBe('null');
  });

  it('orders nested keys recursively', () => {
    expect(jcsStringify({ z: { y: 1, x: [1, { b: 1, a: 2 }] } })).toBe('{"z":{"x":[1,{"a":2,"b":1}],"y":1}}');
  });
});

describe('canonicalRequestHash', () => {
  const base = { method: 'POST', route: '/api/v1/charges', pathParams: {}, query: {}, semanticHeaders: {}, body: { residentId: 'r', type: 'RENT', money: { amount: 1000, currency: 'AFN' } } };

  it('is deterministic for identical requests', () => {
    expect(canonicalRequestHash(base)).toBe(canonicalRequestHash({ ...base, body: { ...base.body } }));
  });

  it('changes when the body differs', () => {
    expect(canonicalRequestHash(base)).not.toBe(
      canonicalRequestHash({ ...base, body: { ...base.body, money: { amount: 1001, currency: 'AFN' } } }),
    );
  });

  it('lowercases the method', () => {
    expect(canonicalRequestHash({ ...base, method: 'post' })).toBe(canonicalRequestHash(base));
  });

  it('includes pathParams when present', () => {
    const a = canonicalRequestHash({ ...base, route: '/api/v1/absences/{absenceId}/credits', pathParams: { absenceId: 'x' } });
    const b = canonicalRequestHash({ ...base, route: '/api/v1/absences/{absenceId}/credits', pathParams: { absenceId: 'y' } });
    expect(a).not.toBe(b);
  });
});