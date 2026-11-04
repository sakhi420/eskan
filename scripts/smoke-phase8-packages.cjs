require('dotenv/config');
const { randomUUID } = require('node:crypto');

const BASE = 'http://127.0.0.1:3000/api/v1';

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  const ok = Boolean(cond);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
}

async function api(method, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  if (opts.orgId) headers['X-Organization-Id'] = opts.orgId;
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  if (opts.version !== undefined) headers['X-Expected-Version'] = String(opts.version);
  const res = await fetch(BASE + path, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const uuid = () => randomUUID();
const reg = (email) =>
  api('POST', '/auth/register', {
    idem: uuid(),
    body: { email, password: 'Password123!', fullName: 'Pkg Owner', organizationName: 'Pkg Org' },
  });

async function main() {
  const s = Date.now();
  const ra = await reg(`pk${s}@example.com`);
  check('register user A', ra.status === 201, 's=' + ra.status);
  const tokenA = ra.body.data.accessToken;
  const orgA = ra.body.data.memberships[0].organizationId;

  const rb = await reg(`pkx${s}@example.com`);
  check('register user B', rb.status === 201, 's=' + rb.status);
  const tokenB = rb.body.data.accessToken;
  const orgB = rb.body.data.memberships[0].organizationId;

  const h = await api('POST', '/hostels', { token: tokenA, orgId: orgA, idem: uuid(), body: { name: 'Pkg Hostel' } });
  check('create hostel', h.status === 201, 's=' + h.status);
  const hostelId = h.body.data.id;

  const pkgBody = {
    name: 'Full Board',
    description: 'bed + meals + laundry',
    components: [
      { kind: 'ACCOMMODATION', name: 'Bed', amount: 3500, deductibleOnAbsence: false },
      { kind: 'BOARD', name: 'Meals', amount: 1800, deductibleOnAbsence: true },
      { kind: 'SERVICE', name: 'Laundry', amount: 700, deductibleOnAbsence: true },
    ],
  };

  const idemKey = uuid();
  const p1 = await api('POST', `/hostels/${hostelId}/packages`, { token: tokenA, orgId: orgA, idem: idemKey, body: pkgBody });
  check('create package -> 201', p1.status === 201, 's=' + p1.status);
  const pkgId = p1.body.data.id;
  check('package has 3 components', p1.body.data.components.length === 3, 'n=' + p1.body.data.components.length);
  check('board deductible flag true', p1.body.data.components.some((c) => c.kind === 'BOARD' && c.deductibleOnAbsence === true));

  const p2 = await api('POST', `/hostels/${hostelId}/packages`, { token: tokenA, orgId: orgA, idem: idemKey, body: pkgBody });
  check('idempotency replay same id', p2.status === 201 && p2.body.data.id === pkgId, 's=' + p2.status);

  const p3 = await api('POST', `/hostels/${hostelId}/packages`, { token: tokenA, orgId: orgA, idem: idemKey, body: { ...pkgBody, name: 'Changed' } });
  check('idempotency different body -> 409', p3.status === 409, 's=' + p3.status);

  const l = await api('GET', `/hostels/${hostelId}/packages`, { token: tokenA, orgId: orgA });
  check('list packages', l.status === 200 && l.body.data.items.length >= 1, 's=' + l.status);

  const g = await api('GET', `/packages/${pkgId}`, { token: tokenA, orgId: orgA });
  check('get package -> 200', g.status === 200 && g.body.data.id === pkgId, 's=' + g.status);

  const ver = p1.body.data.version;
  const u = await api('PATCH', `/packages/${pkgId}`, { token: tokenA, orgId: orgA, version: ver, body: { ...pkgBody, name: 'Full Board v2' } });
  check('update package bumps version', u.status === 200 && u.body.data.version === ver + 1, 's=' + u.status);

  const stale = await api('PATCH', `/packages/${pkgId}`, { token: tokenA, orgId: orgA, version: ver, body: pkgBody });
  check('update stale -> 409', stale.status === 409 && stale.body.code === 'RESOURCE_VERSION_CONFLICT', 's=' + stale.status);

  const bad = await api('POST', `/hostels/${hostelId}/packages`, {
    token: tokenA,
    orgId: orgA,
    idem: uuid(),
    body: { name: 'Meals only', components: [{ kind: 'BOARD', name: 'Meals', amount: 500, deductibleOnAbsence: true }] },
  });
  check('missing ACCOMMODATION -> 422', bad.status === 422, 's=' + bad.status);

  const a = await api('POST', `/packages/${pkgId}/archive`, { token: tokenA, orgId: orgA });
  check('archive package -> ARCHIVED', a.status === 200 && a.body.data.status === 'ARCHIVED', 's=' + a.status);

  const a2 = await api('POST', `/packages/${pkgId}/archive`, { token: tokenA, orgId: orgA });
  check('archive idempotent', a2.status === 200 && a2.body.data.status === 'ARCHIVED', 's=' + a2.status);

  const gx = await api('GET', `/packages/${pkgId}`, { token: tokenB, orgId: orgB });
  check('cross-tenant get -> 404', gx.status === 404, 's=' + gx.status);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(() => {
    console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
    process.exit(fail === 0 ? 0 : 1);
  });