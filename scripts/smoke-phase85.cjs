require('dotenv/config');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
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

  // ---- 1. Register replay recovery ----
  const replayEmail = `p85replay${s}@example.com`;
  const r1 = await reg(replayEmail, 'Replay Owner');
  check('register (first) 201', r1.status === 201, 's=' + r1.status);
  const r2 = await reg(replayEmail, 'Replay Owner');
  check('register replay (same email+password) 201 fresh session', r2.status === 201 && r2.body.data.accessToken && r2.body.data.refreshToken, 's=' + r2.status);
  const r3 = await api('POST', '/auth/register', { idem: uuid(), body: { email: replayEmail, password: 'WrongPass9!', fullName: 'Replay Owner', organizationName: 'Replay Owner Org' } });
  check('register (same email, wrong password) 409', r3.status === 409, 's=' + r3.status);

  // ---- setup org for maintenance + owner races ----
  const ra = await reg(`p85a${s}@example.com`, 'OwnerA85');
  const token = ra.body.data.accessToken;
  const org = ra.body.data.memberships[0].organizationId;

  // ---- 2. Maintenance guard ----
  const h = await api('POST', '/hostels', { token, orgId: org, idem: uuid(), body: { name: 'H85' } });
  const hostelId = h.body.data.id;
  const room = await api('POST', `/hostels/${hostelId}/rooms`, { token, orgId: org, idem: uuid(), body: { code: 'R85A', floor: 1 } });
  const roomId = room.body.data.id;
  const roomVersion = room.body.data.version;
  const bed = await api('POST', `/rooms/${roomId}/beds`, { token, orgId: org, idem: uuid(), body: { code: 'B85A' } });
  const bedId = bed.body.data.id;
  const bedVersion = bed.body.data.version;
  const resident = await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'Maint Res', type: 'STUDENT' } });
  const residentId = resident.body.data.id;
  const c = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId, startDate: '2020-01-01', rent: { amount: 1000, currency: 'AFN' } } });
  const contractId = c.body.data.id;
  await api('POST', `/contracts/${contractId}/activate`, { token, orgId: org });
  await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId, residentId, contractId, startDate: '2020-01-01' } });

  const bedMaint = await api('PATCH', `/beds/${bedId}`, { token, orgId: org, version: bedVersion, body: { code: 'B85A', maintenanceStatus: 'OUT_OF_SERVICE' } });
  check('bed -> OUT_OF_SERVICE with active assignment 409', bedMaint.status === 409 && bedMaint.body && bedMaint.body.code === 'RESOURCE_HAS_ACTIVE_ASSIGNMENT', 's=' + bedMaint.status);
  const roomMaint = await api('PATCH', `/rooms/${roomId}`, { token, orgId: org, version: roomVersion, body: { code: 'R85A', floor: 1, maintenanceStatus: 'OUT_OF_SERVICE' } });
  check('room -> OUT_OF_SERVICE with active assignment 409', roomMaint.status === 409 && roomMaint.body && roomMaint.body.code === 'RESOURCE_HAS_ACTIVE_ASSIGNMENT', 's=' + roomMaint.status);

  // ---- 3. Refresh replay code ----
  const rf1 = await api('POST', '/auth/refresh', { body: { refreshToken: ra.body.data.refreshToken } });
  check('refresh succeeds 200', rf1.status === 200 && rf1.body.data.refreshToken, 's=' + rf1.status);
  const rf2 = await api('POST', '/auth/refresh', { body: { refreshToken: ra.body.data.refreshToken } });
  check('refresh old token -> 401 REFRESH_TOKEN_ROTATION_CONFLICT', rf2.status === 401 && rf2.body && rf2.body.code === 'REFRESH_TOKEN_ROTATION_CONFLICT', 's=' + rf2.status + ' code=' + (rf2.body && rf2.body.code));

  // ---- 4. Last-owner race: two concurrent demotes never drop below one owner ----
  const rb = await reg(`p85b${s}@example.com`, 'OwnerB85');
  const tokenB = rb.body.data.accessToken;
  const membersA = await api('GET', '/organizations/current/members', { token, orgId: org });
  const mA = membersA.body.data.find((m) => m.role === 'OWNER' && m.active === true);
  const meB = await api('GET', '/auth/me', { token: tokenB });
  const userBId = meB.body.data.id;

  const pg = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev' });
  await pg.connect();
  const memberBId = uuid();
  await pg.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, active, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'OWNER', true, now(), now())`,
    [memberBId, org, userBId],
  );

  const [demoteA, demoteB] = await Promise.all([
    api('PATCH', `/organizations/current/members/${mA.id}`, { token, orgId: org, body: { role: 'ADMIN' } }),
    api('PATCH', `/organizations/current/members/${memberBId}`, { token: tokenB, orgId: org, body: { role: 'ADMIN' } }),
  ]);
  const statuses = [demoteA.status, demoteB.status];
  const n200 = statuses.filter((x) => x === 200).length;
  check('last-owner race: exactly one demote succeeds', n200 === 1, 's=' + statuses.join(','));
  const ownerRow = await pg.query(
    `SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = $1 AND role = 'OWNER' AND active = true`,
    [org],
  );
  check('last-owner race: final DB has exactly one active owner', ownerRow.rows[0].n === 1, 'owners=' + ownerRow.rows[0].n);
  await pg.end();
}

main().catch((e) => { console.error(e); fail++; }).finally(() => {
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
});