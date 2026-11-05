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

function businessToday(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

async function main() {
  const s = Date.now();
  const ra = await reg(`p83${s}@example.com`, 'Owner83');
  check('register owner', ra.status === 201, 's=' + ra.status);
  const token = ra.body.data.accessToken;
  const org = ra.body.data.memberships[0].organizationId;

  // ---- hierarchy ----
  const h = await api('POST', '/hostels', { token, orgId: org, idem: uuid(), body: { name: 'H83' } });
  const hostelId = h.body.data.id;
  const roomRes = await api('POST', `/hostels/${hostelId}/rooms`, { token, orgId: org, idem: uuid(), body: { code: 'R83', floor: 1 } });
  const roomId = roomRes.body.data.id;
  const bed1 = (await api('POST', `/rooms/${roomId}/beds`, { token, orgId: org, idem: uuid(), body: { code: 'B83' } })).body.data.id;
  const bed2 = (await api('POST', `/rooms/${roomId}/beds`, { token, orgId: org, idem: uuid(), body: { code: 'B84' } })).body.data.id;
  check('create hierarchy', !!hostelId && !!roomId && !!bed1 && !!bed2);

  // ---- 1. concurrent overlapping contract activations ----
  const resident = (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'Overlap Resident', type: 'STUDENT' } })).body.data.id;
  const mkContract = (startDate, endDate) => api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resident, startDate, endDate, rent: { amount: 1000, currency: 'AFN' } } });
  const cA = await mkContract('2026-01-01', null);
  const cB = await mkContract('2026-02-01', '2026-02-28');
  check('two DRAFT contracts for same resident allowed', cA.status === 201 && cB.status === 201, 's=' + cA.status + ',' + cB.status);

  const [actA, actB] = await Promise.all([
    api('POST', `/contracts/${cA.body.data.id}/activate`, { token, orgId: org }),
    api('POST', `/contracts/${cB.body.data.id}/activate`, { token, orgId: org }),
  ]);
  const codes = [actA.status, actB.status].sort();
  check('concurrent activate -> one 200 one 409', codes[0] === 200 && codes[1] === 409, 's=' + codes.join(','));
  const loser = actA.status === 409 ? actA : actB;
  check('loser code RESIDENT_CONTRACT_OVERLAP', loser.status === 409 && loser.body && loser.body.code === 'RESIDENT_CONTRACT_OVERLAP', 'code=' + (loser.body && loser.body.code));

  // ---- 2. business date in assignment end and checkout ----
  const r2 = (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'BizDate Resident', type: 'WORKER' } })).body.data.id;
  const cBiz = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: r2, startDate: '2020-01-01', rent: { amount: 2000, currency: 'AFN' } } });
  const cBizId = cBiz.body.data.id;
  await api('POST', `/contracts/${cBizId}/activate`, { token, orgId: org });
  const aBiz = await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bed1, residentId: r2, contractId: cBizId, startDate: '2020-01-01' } });
  check('assign for business-date case', aBiz.status === 201, 's=' + aBiz.status);

  const aEnd = await api('POST', `/bed-assignments/${aBiz.body.data.id}/end`, { token, orgId: org });
  const expectedTodayA = businessToday('Asia/Kabul');
  check('assignment endDate = org business today', aEnd.status === 200 && aEnd.body.data.endDate === expectedTodayA, `${aEnd.body.data && aEnd.body.data.endDate} vs ${expectedTodayA}`);

  const co = await api('POST', `/contracts/${cBizId}/checkout`, { token, orgId: org });
  const expectedTodayC = businessToday('Asia/Kabul');
  check('checkout endDate = org business today', co.status === 200 && co.body.data.status === 'CLOSED' && co.body.data.endDate === expectedTodayC, `${co.body.data && co.body.data.endDate} vs ${expectedTodayC}`);

  // ---- 3. assignment create racing with contract terminate ----
  const r3 = (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'Race Resident', type: 'STUDENT' } })).body.data.id;
  const cRace = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: r3, startDate: '2020-01-01', rent: { amount: 2000, currency: 'AFN' } } });
  const cRaceId = cRace.body.data.id;
  await api('POST', `/contracts/${cRaceId}/activate`, { token, orgId: org });
  const [assignRace, termRace] = await Promise.all([
    api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bed2, residentId: r3, contractId: cRaceId, startDate: '2020-01-01' } }),
    api('POST', `/contracts/${cRaceId}/terminate`, { token, orgId: org }),
  ]);
  const invariant =
    (assignRace.status === 201 && termRace.status === 409 && termRace.body && termRace.body.code === 'RESOURCE_HAS_ACTIVE_ASSIGNMENT') ||
    (termRace.status === 200 && assignRace.status === 409 && assignRace.body && assignRace.body.code === 'CONTRACT_NOT_ACTIVE');
  check('assign vs terminate race is consistent', invariant,
    `assign=${assignRace.status}(${assignRace.body && assignRace.body.code}) term=${termRace.status}(${termRace.body && termRace.body.code})`);

  // ---- 4. idempotency lazy expiry ----
  const idemKey = uuid();
  const rFirst = await api('POST', '/residents', { token, orgId: org, idem: idemKey, body: { fullName: 'Idem Resident', type: 'OTHER' } });
  check('idem create resident', rFirst.status === 201, 's=' + rFirst.status);
  const firstId = rFirst.body.data.id;
  const pg = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev' });
  await pg.connect();
  await pg.query(
    `UPDATE idempotency_records SET expires_at = now() - interval '1 day' WHERE organization_id = $1 AND idempotency_key = $2 AND endpoint = '/api/v1/residents'`,
    [org, idemKey],
  );
  const rAgain = await api('POST', '/residents', { token, orgId: org, idem: idemKey, body: { fullName: 'Idem Resident', type: 'OTHER' } });
  check('expired idem key treated absent -> 201 new id', rAgain.status === 201 && rAgain.body.data.id !== firstId, `ids ${firstId} vs ${rAgain.body.data && rAgain.body.data.id}`);
  await pg.end();

  // ---- 5. parent-chain lock-guarded revalidation (bed under archived room) ----
  const room2Res = await api('POST', `/hostels/${hostelId}/rooms`, { token, orgId: org, idem: uuid(), body: { code: 'R84', floor: 1 } });
  const room2Id = room2Res.body.data.id;
  const archRoom = await api('POST', `/rooms/${room2Id}/archive`, { token, orgId: org });
  check('archive empty room', archRoom.status === 200, 's=' + archRoom.status);
  const bedUnderArchived = await api('POST', `/rooms/${room2Id}/beds`, { token, orgId: org, idem: uuid(), body: { code: 'B85' } });
  check('bed create under archived room -> 409', bedUnderArchived.status === 409, 's=' + bedUnderArchived.status);
}

main().catch((e) => { console.error(e); fail++; }).finally(() => {
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
});