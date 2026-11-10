import { createHash } from 'node:crypto';

/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS).
 *
 * Produces a deterministic, compact serialization for canonical-fingerprint
 * hashing (see docs/api/idempotency.md). Rules implemented here:
 *   - object keys sorted by UTF-16 code unit (default JS string ordering);
 *   - arrays keep their order;
 *   - strings are escaped exactly like JSON.stringify (escape `"`, `\` and
 *     control chars < U+0020; non-ASCII bytes are NOT escaped);
 *   - numbers use ECMAScript Number::toString (JSON.stringify is equivalent for
 *     this purpose), so no Float/Double rounding is ever performed — callers are
 *     required to keep money values as integers (A-016, F-26).
 *   - no insignificant whitespace in the output.
 */
export function jcsStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcsStringify).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys.map((k) => `${JSON.stringify(k)}:${jcsStringify(obj[k])}`).join(',') +
      '}'
    );
  }
  // undefined / symbol / function cannot originate from validated JSON input.
  return 'null';
}

function serializeNumber(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 'null';
  if (Object.is(value, -0)) return '0';
  return JSON.stringify(value);
}

export interface CanonicalRequest {
  method: string;
  route: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string[]>;
  semanticHeaders?: Record<string, unknown>;
  body?: unknown;
}

/**
 * The six-field canonical financial fingerprint, matching the contract's
 * canonical-hashing spec (docs/api/idempotency.md): SHA-256 over the JCS
 * serialization of `{ method, route, pathParams, query, semanticHeaders, body }`.
 * `Idempotency-Key`, `Authorization`, `User-Agent`, timestamps and the
 * `X-Organization-Id` selector are intentionally excluded (organization scope is
 * already carried by the idempotency record key).
 */
export function canonicalRequestHash(request: CanonicalRequest): string {
  const canonical = {
    method: request.method.toUpperCase(),
    route: request.route,
    pathParams: request.pathParams ?? {},
    query: request.query ?? {},
    semanticHeaders: request.semanticHeaders ?? {},
    body: request.body ?? {},
  };
  return createHash('sha256').update(jcsStringify(canonical)).digest('hex');
}