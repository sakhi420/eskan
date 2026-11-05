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
  const ra = await reg(`p84${s}@example.com`, 'Owner84');
  check('register owner', ra.status === 201, 's=' + ra.status);
  const token = ra.body.data.accessToken;
  const org = ra.body.data.memberships[0].organizationId;

  const h = await api('POST', '/hostels', { token, orgId: org, idem: uuid(), body: { name: 'H84' } });
  const hostelId = h.body.data.id;
  const mkRoom = (code) => api('POST', `/hostels/${hostelId}/rooms`, { token, orgId: org, idem: uuid(), body: { code, floor: 1 } });
  const roomId = (await mkRoom('R84A')).body.data.id;
  const mkBed = (room, code) => api('POST', `/rooms/${room}/beds`, { token, orgId: org, idem: uuid(), body: { code } });
  const bedB1 = (await mkBed(roomId, 'B84A')).body.data.id;
  const bedB2 = (await mkBed(roomId, 'B84B')).body.data.id;

  // 1. contract hostel/resident immutability
  const resA = (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'Immutable Res', type: 'STUDENT' } })).body.data.id;
  const resB = (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'Other Res', type: 'STUDENT' } })).body.data.id;
  const cI = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resA, startDate: '2020-01-01', rent: { amount: 1000, currency: 'AFN' } } });
  const reparent = await api('PATCH', `/contracts/${cI.body.data.id}`, { token, orgId: org, version: cI.body.data.version, body: { hostelId, residentId: resB, startDate: '2020-01-01', rent: { amount: 1000, currency: 'AFN' } } });
  check('contract re-parent rejected 409', reparent.status === 409 && reparent.body && reparent.body.code === 'BUSINESS_RULE_VIOLATION', 's=' + reparent.status);

  // concurrent update (same parents) vs activate
  const cU = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resA, startDate: '2020-01-01', rent: { amount: 1000, currency: 'AFN' } } });
  const cUId = cU.body.data.id;
  const cUVersion = cU.body.data.version;
  const [updRace, actRace] = await Promise.all([
    api('PATCH', `/contracts/${cUId}`, { token, orgId: org, version: cUVersion, body: { hostelId, residentId: resA, startDate: '2020-01-01', rent: { amount: 1500, currency: 'AFN' }, notes: 'raced' } }),
    api('POST', `/contracts/${cUId}/activate`, { token, orgId: org }),
  ]);
  check('update vs activate: no 5xx', updRace.status < 500 && actRace.status < 500, `upd=${updRace.status} act=${actRace.status}`);
  check('update vs activate: activate succeeds', actRace.status === 200, 'act=' + actRace.status);
  check('update vs activate: update 2xx/409', updRace.status === 200 || updRace.status === 409, 'upd=' + updRace.status);
  const cUGet = await api('GET', `/contracts/${cUId}`, { token, orgId: org });
  check('update vs activate: final ACTIVE', cUGet.body.data.status === 'ACTIVE', 'status=' + cUGet.body.data.status);

  // 2. Hostel archive vs room create (race)
  const h2 = await api('POST', '/hostels', { token, orgId: org, idem: uuid(), body: { name: 'H84-race' } });
  const h2Id = h2.body.data.id;
  const [archH, createRoom] = await Promise.all([
    api('POST', `/hostels/${h2Id}/archive`, { token, orgId: org }),
    api('POST', `/hostels/${h2Id}/rooms`, { token, orgId: org, idem: uuid(), body: { code: 'R-RACE', floor: 1 } }),
  ]);
  const archHOk = archH.status === 200;
  const createRoomOk = createRoom.status === 201;
  check('hostel archive vs room create: not both succeed', !(archHOk && createRoomOk), `arch=${archH.status} room=${createRoom.status}`);
  check('hostel archive vs room create: loser 409', archHOk ? createRoom.status === 409 : archH.status === 409, `arch=${archH.status} room=${createRoom.status}`);

  // 3. Room archive vs bed create (race)
  const roomR2Id = (await mkRoom('R84B')).body.data.id;
  const [archR, createBed] = await Promise.all([
    api('POST', `/rooms/${roomR2Id}/archive`, { token, orgId: org }),
    api('POST', `/rooms/${roomR2Id}/beds`, { token, orgId: org, idem: uuid(), body: { code: 'B-RACE' } }),
  ]);
  const archROk = archR.status === 200;
  const createBedOk = createBed.status === 201;
  check('room archive vs bed create: not both succeed', !(archROk && createBedOk), `arch=${archR.status} bed=${createBed.status}`);
  check('room archive vs bed create: loser 409', archROk ? createBed.status === 409 : archR.status === 409, `arch=${archR.status} bed=${createBed.status}`);

  // 4. Bed deactivate vs assignment create (race)
  const resD = (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'Deactivate Res', type: 'STUDENT' } })).body.data.id;
  const cD = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resD, startDate: '2020-01-01', rent: { amount: 1000, currency: 'AFN' } } });
  const cDId = cD.body.data.id;
  await api('POST', `/contracts/${cDId}/activate`, { token, orgId: org });
  const bedB3 = (await mkBed(roomId, 'B84C')).body.data.id;
  const [deact, assignRace] = await Promise.all([
    api('POST', `/beds/${bedB3}/deactivate`, { token, orgId: org }),
    api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bedB3, residentId: resD, contractId: cDId, startDate: '2020-01-01' } }),
  ]);
  const deactOk = deact.status === 200;
  const assignOk = assignRace.status === 201;
  check('bed deactivate vs assign: not both succeed', !(deactOk && assignOk), `deact=${deact.status} assign=${assignRace.status}`);
  check('bed deactivate vs assign: loser 409', deactOk ? assignRace.status === 409 : deact.status === 409, `deact=${deact.status} assign=${assignRace.status}`);

  // 5. transfer date boundaries
  const resT = (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'Transfer Res', type: 'STUDENT' } })).body.data.id;
  const cT = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resT, startDate: '2020-01-01', rent: { amount: 1000, currency: 'AFN' } } });
  const cTId = cT.body.data.id;
  await api('POST', `/contracts/${cTId}/activate`, { token, orgId: org });
  const aT = await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bedB1, residentId: resT, contractId: cTId, startDate: '2020-01-01' } });
  const tfSame = await api('POST', `/bed-assignments/${aT.body.data.id}/transfer`, { token, orgId: org, idem: uuid(), body: { bedId: bedB2, startDate: '2020-01-01' } });
  check('transfer on start day rejected 409', tfSame.status === 409, 's=' + tfSame.status);

  const resE = (await api('POST', '/residents', { token, orgId: org, idem: uuid(), body: { fullName: 'Transfer End Res', type: 'STUDENT' } })).body.data.id;
  const cE = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resE, startDate: '2020-01-01', endDate: '2020-12-31', rent: { amount: 1000, currency: 'AFN' } } });
  const cEId = cE.body.data.id;
  await api('POST', `/contracts/${cEId}/activate`, { token, orgId: org });
  const aE = await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bedB2, residentId: resE, contractId: cEId, startDate: '2020-06-01' } });
  const aEId = aE.body.data.id;
  const tfBeyond = await api('POST', `/bed-assignments/${aEId}/transfer`, { token, orgId: org, idem: uuid(), body: { bedId: bedB1, startDate: '2020-06-02', endDate: '2021-01-01' } });
  check('transfer past contract end rejected 409', tfBeyond.status === 409, 's=' + tfBeyond.status);
  const tfOnEnd = await api('POST', `/bed-assignments/${aEId}/transfer`, { token, orgId: org, idem: uuid(), body: { bedId: bedB1, startDate: '2020-12-31' } });
  check('transfer on/after contract end rejected 409', tfOnEnd.status === 409, 's=' + tfOnEnd.status);

  // 6. checkout date validation
  const cF = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resE, startDate: '2999-01-01', rent: { amount: 1000, currency: 'AFN' } } });
  const cFId = cF.body.data.id;
  await api('POST', `/contracts/${cFId}/activate`, { token, orgId: org });
  const coFuture = await api('POST', `/contracts/${cFId}/checkout`, { token, orgId: org });
  check('checkout on/before contract start rejected 409', coFuture.status === 409, 's=' + coFuture.status);

  await api('POST', `/contracts/${cTId}/checkout`, { token, orgId: org });
  const cG = await api('POST', '/contracts', { token, orgId: org, idem: uuid(), body: { hostelId, residentId: resT, startDate: '2020-01-01', rent: { amount: 1000, currency: 'AFN' } } });
  const cGId = cG.body.data.id;
  await api('POST', `/contracts/${cGId}/activate`, { token, orgId: org });
  await api('POST', '/bed-assignments', { token, orgId: org, idem: uuid(), body: { bedId: bedB1, residentId: resT, contractId: cGId, startDate: '2999-01-01' } });
  const coAssignFuture = await api('POST', `/contracts/${cGId}/checkout`, { token, orgId: org });
  check('checkout with future-start assignment rejected 409', coAssignFuture.status === 409, 's=' + coAssignFuture.status);

  // 7. timezone validation
  const cur = await api('GET', '/organizations/current', { token, orgId: org });
  const orgVersion = cur.body.data.version;
  const tzBad = await api('PATCH', '/organizations/current', { token, orgId: org, version: orgVersion, body: { timezone: 'INVALID_ZONE' } });
  check('invalid timezone rejected 422', tzBad.status === 422, 's=' + tzBad.status);
  const tzOk = await api('PATCH', '/organizations/current', { token, orgId: org, version: orgVersion, body: { timezone: 'Asia/Kabul' } });
  check('valid timezone accepted 200', tzOk.status === 200, 's=' + tzOk.status);

  // 8. DB final-state consistency for the three races
  const pg = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev' });
  await pg.connect();
  const r = async (q, p = []) => (await pg.query(q, p)).rows;
  const roomState = await r(`SELECT r.status, (SELECT count(*) FROM beds b WHERE b.room_id = $1 AND b.status = 'ACTIVE')::int AS beds FROM rooms r WHERE r.id = $1`, [roomR2Id]);
  const roomConsistent = (roomState[0].status === 'ARCHIVED' && roomState[0].beds === 0) || (roomState[0].status === 'ACTIVE' && roomState[0].beds === 1);
  check('room vs bed race: final DB consistent', roomConsistent, JSON.stringify(roomState[0]));
  const hostelState = await r(`SELECT h.status, (SELECT count(*) FROM rooms x WHERE x.hostel_id = $1 AND x.status = 'ACTIVE')::int AS rooms FROM hostels h WHERE h.id = $1`, [h2Id]);
  const hostelConsistent = (hostelState[0].status === 'ARCHIVED' && hostelState[0].rooms === 0) || (hostelState[0].status === 'ACTIVE' && hostelState[0].rooms === 1);
  check('hostel vs room race: final DB consistent', hostelConsistent, JSON.stringify(hostelState[0]));
  const bedState = await r(`SELECT b.status, (SELECT count(*) FROM bed_assignments a WHERE a.bed_id = $1 AND a.status = 'ACTIVE')::int AS assigns FROM beds b WHERE b.id = $1`, [bedB3]);
  const bedConsistent = (bedState[0].status === 'INACTIVE' && bedState[0].assigns === 0) || (bedState[0].status === 'ACTIVE' && bedState[0].assigns === 1);
  check('bed vs assign race: final DB consistent', bedConsistent, JSON.stringify(bedState[0]));
  await pg.end();
}

main().catch((e) => { console.error(e); fail++; }).finally(() => {
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
});