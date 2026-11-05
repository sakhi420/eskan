require('dotenv/config');
const { randomUUID } = require('node:crypto');
const BASE = 'http://127.0.0.1:3000/api/v1';
let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  const ok = Boolean(cond);
  if (ok) pass++; else fail++;
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
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}
const uuid = () => randomUUID();
const reg = (email, name) => api('POST', '/auth/register', { idem: uuid(), body: { email, password: 'Password123!', fullName: name, organizationName: name + ' Org' } });
const refresh = (refreshToken) => api('POST', '/auth/refresh', { body: { refreshToken } });

async function main() {
  const s = Date.now();
  const ra = await reg(`p82${s}@example.com`, 'Owner82');
  check('register', ra.status === 201, 's=' + ra.status);
  const token = ra.body.data.accessToken;
  const org = ra.body.data.memberships[0].organizationId;

  // ---- 1. Refresh rotation semantics (P0) ----
  const oldRt = ra.body.data.refreshToken;
  const [r1, r2] = await Promise.all([refresh(oldRt), refresh(oldRt)]);
  const codes = [r1.status, r2.status].sort();
  check('concurrent refresh same token -> one 200 one 401', codes[0] === 200 && codes[1] === 401, 's=' + codes.join(','));
  const winner = r1.status === 200 ? r1 : r2;
  check('winner returns a fresh refresh token', winner.status === 200 && !!winner.body.data.refreshToken && winner.body.data.refreshToken !== oldRt, 's=' + winner.status);
  const newRt1 = winner.body.data.refreshToken;
  const r3 = await refresh(newRt1);
  check('family NOT revoked: winner token rotates again (200)', r3.status === 200, 's=' + r3.status);
  const newRt2 = r3.body.data.refreshToken;
  const r4 = await refresh(oldRt);
  check('later stale-token reuse -> 401', r4.status === 401, 's=' + r4.status);
  const r5 = await refresh(newRt2);
  check('family revoked after proven reuse (latest token also 401)', r5.status === 401, 's=' + r5.status);

  // ---- Hierarchy ----
  const h = await api('POST', '/hostels', { token, orgId: org, idem: uuid(), body: { name: 'H-main', defaultRentAmount: 5000 } });
  const hostelId = h.body.data.id;
  const roomRes = await api('POST', `/hostels/${hostelId}/rooms`, { token, orgId: org, idem: uuid(), body: { code: 'A1', floor: 1 } });
  const roomId = roomRes.body.data.id;
  const mkBed = async (code) => (await api('POST', `/rooms/${roomId}/beds`, { token, orgId: org, idem: uuid(), body: { code } })).body.data.id;
  const bed1 = await mkBed('B1');
  const bed2 = await mkBed('B2');
  const bed3 = await mkBed('B3');
  const bed4 = await mkBed('B4');
  check('create 4 beds', !!bed1 && !!bed2 && !!bed3 && !!bed4);

  const mkResident = async (name) => (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: name, type: 'STUDENT' } })).body.data.id;
  const resident1 = await mkResident('R1');

  // ---- 2. Contract / assignment date-range (P0) ----
  const noEnd = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resident1, startDate: '2026-01-01', rent: { amount: 5000, currency: 'AFN' } } });
  check('contract create (open-ended)', noEnd.status === 201, 's=' + noEnd.status);
  const contractA = noEnd.body.data.id;
  await api('POST', `/contracts/${contractA}/activate`, { token, orgId: org });

  const badEnd = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resident1, startDate: '2026-01-01', endDate: '2026-01-01', rent: { amount: 5000, currency: 'AFN' } } });
  check('contract endDate <= startDate -> 422', badEnd.status === 422, 's=' + badEnd.status);

  const beforeStart = await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bed1, residentId: resident1, contractId: contractA, startDate: '2025-12-01' } });
  check('assignment before contract start -> 409', beforeStart.status === 409, 's=' + beforeStart.status);

  const bounded = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resident1, startDate: '2026-02-01', endDate: '2026-02-28', rent: { amount: 5000, currency: 'AFN' } } });
  const contractB = bounded.body.data.id;
  await api('POST', `/contracts/${contractB}/activate`, { token, orgId: org });
  const beyondEnd = await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bed1, residentId: resident1, contractId: contractB, startDate: '2026-02-01', endDate: '2026-03-31' } });
  check('assignment extends beyond contract end -> 409', beyondEnd.status === 409, 's=' + beyondEnd.status);

  // ---- 3. Assignment create + transfer idempotency (P0) ----
  const assign1 = await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bed1, residentId: resident1, contractId: contractA, startDate: '2026-01-01' } });
  check('create assignment (transfer source)', assign1.status === 201, 's=' + assign1.status);
  const assignmentId = assign1.body.data.id;

  const missKey = await api('POST', `/bed-assignments/${assignmentId}/transfer`, { token, orgId: org, body: { bedId: bed2, startDate: '2026-01-15' } });
  check('transfer missing Idempotency-Key -> 422', missKey.status === 422, 's=' + missKey.status);

  const tKey = uuid();
  const tBody = { bedId: bed2, startDate: '2026-01-15' };
  const t1 = await api('POST', `/bed-assignments/${assignmentId}/transfer`, { token, orgId: org, idem: tKey, body: tBody });
  check('transfer succeeds (atomic end+start)', t1.status === 200 && t1.body.data.previous.status === 'ENDED' && t1.body.data.assignment.status === 'ACTIVE' && t1.body.data.previous.endDate === t1.body.data.assignment.startDate, 's=' + t1.status);
  const t2 = await api('POST', `/bed-assignments/${assignmentId}/transfer`, { token, orgId: org, idem: tKey, body: { bedId: bed2, startDate: '2026-01-15' } });
  check('transfer same key replay -> 200 stored result', t2.status === 200 && t2.body.data.previous.id === t1.body.data.previous.id && t2.body.data.assignment.id === t1.body.data.assignment.id, 's=' + t2.status);
  const tDiff = await api('POST', `/bed-assignments/${assignmentId}/transfer`, { token, orgId: org, idem: tKey, body: { bedId: bed2, startDate: '2026-01-16' } });
  check('transfer different payload same key -> 409', tDiff.status === 409, 's=' + tDiff.status);

  // ---- 4. Create replay after checkout + checkout idempotency ----
  const resident2 = await mkResident('R2');
  const cC = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resident2, startDate: '2026-01-01', rent: { amount: 5000, currency: 'AFN' } } });
  const contractC = cC.body.data.id;
  await api('POST', `/contracts/${contractC}/activate`, { token, orgId: org });

  const createKey = uuid();
  const createBody = { bedId: bed3, residentId: resident2, contractId: contractC, startDate: '2026-01-01' };
  const aCreate = await api('POST', '/bed-assignments', { token, orgId: org, idem: createKey, body: createBody });
  check('create assignment (for post-checkout replay)', aCreate.status === 201, 's=' + aCreate.status);

  const co = await api('POST', `/contracts/${contractC}/checkout`, { token, orgId: org });
  check('checkout closes contract atomically', co.status === 200 && co.body.data.status === 'CLOSED', 's=' + co.status);

  const aReplay = await api('POST', '/bed-assignments', { token, orgId: org, idem: createKey, body: createBody });
  check('create replay after checkout returns stored result', aReplay.status === 201 && aReplay.body.data.id === aCreate.body.data.id, 's=' + aReplay.status);

  const co2 = await api('POST', `/contracts/${contractC}/checkout`, { token, orgId: org });
  check('checkout idempotent (repeat -> 200 CLOSED)', co2.status === 200 && co2.body.data.status === 'CLOSED', 's=' + co2.status);

  // ---- 5. Activate + terminate idempotency / CAS ----
  const resident3 = await mkResident('R3');
  const cE = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resident3, startDate: '2026-01-01', rent: { amount: 5000, currency: 'AFN' } } });
  const contractE = cE.body.data.id;
  const act1 = await api('POST', `/contracts/${contractE}/activate`, { token, orgId: org });
  check('activate contract -> 200 ACTIVE', act1.status === 200 && act1.body.data.status === 'ACTIVE', 's=' + act1.status);
  const act2 = await api('POST', `/contracts/${contractE}/activate`, { token, orgId: org });
  check('activate idempotent (repeat -> 200 ACTIVE)', act2.status === 200 && act2.body.data.status === 'ACTIVE', 's=' + act2.status);

  const term1 = await api('POST', `/contracts/${contractE}/terminate`, { token, orgId: org });
  check('terminate contract -> 200 TERMINATED', term1.status === 200 && term1.body.data.status === 'TERMINATED', 's=' + term1.status);
  const term2 = await api('POST', `/contracts/${contractE}/terminate`, { token, orgId: org });
  check('terminate idempotent (repeat -> 200 TERMINATED)', term2.status === 200 && term2.body.data.status === 'TERMINATED', 's=' + term2.status);
}

main().catch((e) => { console.error(e); fail++; }).finally(() => {
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
});