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
async function main() {
  const s = Date.now();
  const ra = await reg(`p81${s}@example.com`, 'Owner81');
  check('register', ra.status === 201, 's=' + ra.status);
  const token = ra.body.data.accessToken;
  const org = ra.body.data.memberships[0].organizationId;

  // 1. Invalid calendar date is rejected at validation (no Date rollover).
  const badContract = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId: uuid(), residentId: uuid(), startDate: '2026-02-31', rent: { amount: 5000, currency: 'AFN' } } });
  check('invalid date contract -> 422', badContract.status === 422, 's=' + badContract.status);

  // 2. Archived parent blocks child creation.
  const hArc = await api('POST', '/hostels', { token, orgId: org, idem: uuid(), body: { name: 'H-arch' } });
  const hArcId = hArc.body.data.id;
  await api('POST', `/hostels/${hArcId}/archive`, { token, orgId: org });
  const roomUnderArch = await api('POST', `/hostels/${hArcId}/rooms`, { token, orgId: org, idem: uuid(), body: { code: 'Z1', floor: 1 } });
  check('archived hostel blocks new room', roomUnderArch.status === 409, 's=' + roomUnderArch.status);

  // 3. Main hierarchy.
  const h = await api('POST', '/hostels', { token, orgId: org, idem: uuid(), body: { name: 'H-main', contactPhone: '0799000000', defaultRentAmount: 5000, rentDueDayOfMonth: 5, absenceMinDays: 3 } });
  check('create hostel with v0.4 fields', h.status === 201 && h.body.data.contactPhone === '0799000000' && h.body.data.defaultRentAmount === 5000 && h.body.data.rentDueDayOfMonth === 5 && h.body.data.absenceMinDays === 3, 's=' + h.status);
  const hostelId = h.body.data.id;
  const hostVer = h.body.data.version;

  const roomRes = await api('POST', `/hostels/${hostelId}/rooms`, { token, orgId: org, idem: uuid(), body: { code: 'A1', floor: 1 } });
  const roomId = roomRes.body.data.id;
  check('create room (maintenanceStatus OPERATIONAL)', roomRes.status === 201 && roomRes.body.data.maintenanceStatus === 'OPERATIONAL');

  const mkBed = async (code) => { const b = await api('POST', `/rooms/${roomId}/beds`, { token, orgId: org, idem: uuid(), body: { code } }); return b.body.data.id; };
  const bed1 = await mkBed('B1');
  const bed2 = await mkBed('B2');
  const bed3 = await mkBed('B3');
  const bed4 = await mkBed('B4');
  check('create 4 beds', !!bed1 && !!bed2 && !!bed3 && !!bed4);

  // Room archive blocks bed creation (separate room).
  const roomArcRes = await api('POST', `/hostels/${hostelId}/rooms`, { token, orgId: org, idem: uuid(), body: { code: 'A-arch', floor: 2 } });
  const roomArcId = roomArcRes.body.data.id;
  await api('POST', `/rooms/${roomArcId}/archive`, { token, orgId: org });
  const bedUnderArch = await api('POST', `/rooms/${roomArcId}/beds`, { token, orgId: org, idem: uuid(), body: { code: 'B9' } });
  check('archived room blocks new bed', bedUnderArch.status === 409, 's=' + bedUnderArch.status);

  // 4. Concurrent idempotency: same key + same body -> single resource, both 201.
  const residentRes = await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'R1', type: 'STUDENT' } });
  const resident1 = residentRes.body.data.id;
  const cRes = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resident1, startDate: '2026-01-01', rent: { amount: 5000, currency: 'AFN' } } });
  const contract1 = cRes.body.data.id;
  const actRes = await api('POST', `/contracts/${contract1}/activate`, { token, orgId: org });
  check('resident+contract ready', cRes.status === 201 && actRes.body.data.status === 'ACTIVE');

  const idemKey = uuid();
  const assBody = { bedId: bed1, residentId: resident1, contractId: contract1, startDate: '2026-01-01' };
  const [i1, i2] = await Promise.all([
    api('POST', '/bed-assignments', { token, orgId: org, idem: idemKey, body: assBody }),
    api('POST', '/bed-assignments', { token, orgId: org, idem: idemKey, body: assBody }),
  ]);
  check('concurrent idempotency: both 201 same assignment', i1.status === 201 && i2.status === 201 && i1.body.data.id === i2.body.data.id, 's=' + i1.status + ',' + i2.status);

  // 5. Resident single concurrent assignment (app-level): resident1 already active.
  const singleDouble = await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bed2, residentId: resident1, contractId: contract1, startDate: '2026-02-01' } });
  check('resident cannot hold a second bed (409)', singleDouble.status === 409, 's=' + singleDouble.status);

  // 6. Concurrent resident double-bed (two different beds, fresh resident).
  const resident2Res = await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'R2', type: 'STUDENT' } });
  const resident2 = resident2Res.body.data.id;
  const c2Res = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resident2, startDate: '2026-01-01', rent: { amount: 5000, currency: 'AFN' } } });
  const contract2 = c2Res.body.data.id;
  await api('POST', `/contracts/${contract2}/activate`, { token, orgId: org });
  const [d1, d2] = await Promise.all([
    api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bed3, residentId: resident2, contractId: contract2, startDate: '2026-01-10' } }),
    api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bed4, residentId: resident2, contractId: contract2, startDate: '2026-01-11' } }),
  ]);
  const ds = [d1.status, d2.status].sort();
  check('concurrent resident double-bed: one 201 one 409', ds[0] === 201 && ds[1] === 409, 's=' + ds.join(','));

  // 7. Concurrent optimistic locking (same version).
  const [p1, p2] = await Promise.all([
    api('PATCH', `/hostels/${hostelId}`, { token, orgId: org, version: hostVer, body: { name: 'H-main-A' } }),
    api('PATCH', `/hostels/${hostelId}`, { token, orgId: org, version: hostVer, body: { name: 'H-main-B' } }),
  ]);
  const ps = [p1.status, p2.status].sort();
  check('concurrent optimistic lock: one 200 one 409', ps[0] === 200 && ps[1] === 409, 's=' + ps.join(','));

  // 8. Transfer + checkout (atomic transitions).
  const assignmentRes = await api('GET', `/residents/${resident1}/assignments`, { token, orgId: org });
  const activeAssign = (Array.isArray(assignmentRes.body.data) ? assignmentRes.body.data : []).find((a) => a.status === 'ACTIVE');
  const tr = await api('POST', `/bed-assignments/${activeAssign.id}/transfer`, { token, orgId: org, body: { bedId: bed2, startDate: '2026-03-01' } });
  check('transfer: ends previous and starts new', tr.status === 200 && tr.body.data.previous.status === 'ENDED' && tr.body.data.assignment.status === 'ACTIVE' && !!tr.body.data.previous.endDate, 's=' + tr.status);

  const co = await api('POST', `/contracts/${contract1}/checkout`, { token, orgId: org });
  check('checkout closes contract atomically', co.status === 200 && co.body.data.status === 'CLOSED', 's=' + co.status);
}

main().catch((e) => { console.error(e); fail++; }).finally(() => {
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
});