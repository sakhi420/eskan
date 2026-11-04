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
  const ra = await reg(`p8a${s}@example.com`, 'Owner A');
  check('register A', ra.status === 201, 's=' + ra.status);
  const tokenA = ra.body.data.accessToken;
  const orgA = ra.body.data.memberships[0].organizationId;
  const rb = await reg(`p8b${s}@example.com`, 'Owner B');
  check('register B', rb.status === 201, 's=' + rb.status);
  const tokenB = rb.body.data.accessToken;
  const orgB = rb.body.data.memberships[0].organizationId;

  const h = await api('POST', '/hostels', { token: tokenA, orgId: orgA, idem: uuid(), body: { name: 'Phase8 Hostel' } });
  check('create hostel', h.status === 201, 's=' + h.status);
  const hostelId = h.body.data.id;
  const r = await api('POST', `/hostels/${hostelId}/rooms`, { token: tokenA, orgId: orgA, idem: uuid(), body: { code: '101', floor: 1 } });
  check('create room', r.status === 201, 's=' + r.status);
  const roomId = r.body.data.id;
  const mkBed = (code, maintenanceStatus) => api('POST', `/rooms/${roomId}/beds`, { token: tokenA, orgId: orgA, idem: uuid(), body: { code, ...(maintenanceStatus ? { maintenanceStatus } : {}) } });
  const b1 = await mkBed('B1');
  const b2 = await mkBed('B2');
  const b3 = await mkBed('B3', 'OUT_OF_SERVICE');
  check('create beds', b1.status === 201 && b2.status === 201 && b3.status === 201);
  const bed1 = b1.body.data.id;
  const bed2 = b2.body.data.id;
  const bedBroken = b3.body.data.id;
  check('broken bed persisted', b3.body.data.maintenanceStatus === 'OUT_OF_SERVICE');

  const pkgBody = {
    name: 'Full Board', description: 'bed + meals + laundry',
    components: [
      { kind: 'ACCOMMODATION', name: 'Bed', amount: 3500, deductibleOnAbsence: false },
      { kind: 'BOARD', name: 'Meals', amount: 1800, deductibleOnAbsence: true },
      { kind: 'SERVICE', name: 'Laundry', amount: 700, deductibleOnAbsence: true },
    ],
  };
  const p = await api('POST', `/hostels/${hostelId}/packages`, { token: tokenA, orgId: orgA, idem: uuid(), body: pkgBody });
  check('create package', p.status === 201, 's=' + p.status);
  const pkgId = p.body.data.id;

  const residentDto = { fullName: 'Ahmad Student', type: 'STUDENT', phone: '0700123456', emergencyContactName: 'Father', emergencyContactPhone: '0770999888', emergencyContactRelation: 'Father' };
  const rk = uuid();
  const rc = await api('POST', '/residents', { token: tokenA, orgId: orgA, idem: rk, body: residentDto });
  check('create resident', rc.status === 201 && rc.body.data.fullName === 'Ahmad Student', 's=' + rc.status);
  const residentId = rc.body.data.id;
  check('resident emergency persisted', rc.body.data.emergencyContactName === 'Father');
  const rc2 = await api('POST', '/residents', { token: tokenA, orgId: orgA, idem: rk, body: residentDto });
  check('resident idempotency replay', rc2.status === 201 && rc2.body.data.id === residentId, 's=' + rc2.status);
  const rc3 = await api('POST', '/residents', { token: tokenA, orgId: orgA, idem: rk, body: { ...residentDto, fullName: 'Other' } });
  check('resident idempotency diff 409', rc3.status === 409, 's=' + rc3.status);
  const rc4 = await api('POST', '/residents', { token: tokenA, orgId: orgA, body: residentDto });
  check('resident no idem 422', rc4.status === 422, 's=' + rc4.status);
  const rl = await api('GET', '/residents?q=Ahmad&type=STUDENT', { token: tokenA, orgId: orgA });
  check('list residents filter', rl.status === 200 && rl.body.data.items.length >= 1, 's=' + rl.status);
  const rg = await api('GET', `/residents/${residentId}`, { token: tokenA, orgId: orgA });
  check('get resident', rg.status === 200, 's=' + rg.status);
  const rgx = await api('GET', `/residents/${residentId}`, { token: tokenB, orgId: orgB });
  check('cross-tenant resident 404', rgx.status === 404, 's=' + rgx.status);
  const rv = rg.body.data.version;
  const ru = await api('PATCH', `/residents/${residentId}`, { token: tokenA, orgId: orgA, version: rv, body: { ...residentDto, notes: 'updated' } });
  check('update resident', ru.status === 200 && ru.body.data.version === rv + 1, 's=' + ru.status);
  const rStale = await api('PATCH', `/residents/${residentId}`, { token: tokenA, orgId: orgA, version: rv, body: residentDto });
  check('update resident stale 409', rStale.status === 409, 's=' + rStale.status);
const contractDto = { hostelId, residentId, startDate: '2026-06-01', endDate: '2026-12-31', rent: { amount: 6000, currency: 'AFN' }, billingCycle: 'MONTHLY', deposit: { amount: 6000, currency: 'AFN' }, packageId: pkgId, notes: 'n' };
  const ck = uuid();
  const c1 = await api('POST', '/contracts', { token: tokenA, orgId: orgA, idem: ck, body: contractDto });
  check('create contract DRAFT', c1.status === 201 && c1.body.data.status === 'DRAFT', 's=' + c1.status);
  const contractId = c1.body.data.id;
  check('contract snapshot 3 components', c1.body.data.packageComponents.length === 3);
  check('rent 6000 mapped', c1.body.data.rent.amount === 6000 && c1.body.data.rent.currency === 'AFN');
  const boardSnap = c1.body.data.packageComponents.find((c) => c.kind === 'BOARD');
  check('snapshot board 1800', boardSnap && boardSnap.amount === 1800);
  const c1r = await api('POST', '/contracts', { token: tokenA, orgId: orgA, idem: ck, body: contractDto });
  check('contract idempotency replay', c1r.status === 201 && c1r.body.data.id === contractId, 's=' + c1r.status);
  const cMis = await api('POST', '/contracts', { token: tokenA, orgId: orgA, idem: uuid(), body: { ...contractDto, rent: { amount: 5000, currency: 'AFN' } } });
  check('rent != package sum 422', cMis.status === 422, 's=' + cMis.status);

  const pv = p.body.data.version;
  const p2 = await api('PATCH', `/packages/${pkgId}`, { token: tokenA, orgId: orgA, version: pv, body: { ...pkgBody, components: pkgBody.components.map((c) => (c.kind === 'BOARD' ? { ...c, amount: 2000 } : c)) } });
  check('update package board->2000', p2.status === 200, 's=' + p2.status);
  const cGet = await api('GET', `/contracts/${contractId}`, { token: tokenA, orgId: orgA });
  const boardSnap2 = cGet.body.data.packageComponents.find((c) => c.kind === 'BOARD');
  check('snapshot stable after pkg change', boardSnap2 && boardSnap2.amount === 1800, 'a=' + (boardSnap2 && boardSnap2.amount));

  const p3 = await api('POST', `/hostels/${hostelId}/packages`, { token: tokenA, orgId: orgA, idem: uuid(), body: { ...pkgBody, name: 'Second Pkg' } });
  const pkg2Id = p3.body.data.id;
  await api('POST', `/packages/${pkg2Id}/archive`, { token: tokenA, orgId: orgA });
  const cArch = await api('POST', '/contracts', { token: tokenA, orgId: orgA, idem: uuid(), body: { ...contractDto, packageId: pkg2Id } });
  check('archived package not selectable 404', cArch.status === 404, 's=' + cArch.status);

  const cAct = await api('POST', `/contracts/${contractId}/activate`, { token: tokenA, orgId: orgA });
  check('activate contract', cAct.status === 200 && cAct.body.data.status === 'ACTIVE', 's=' + cAct.status);
  const cUpd = await api('PATCH', `/contracts/${contractId}`, { token: tokenA, orgId: orgA, version: c1.body.data.version + 1, body: contractDto });
  check('update non-DRAFT 409', cUpd.status === 409, 's=' + cUpd.status);
// second resident + active contract for handoff/concurrency
  const r2 = await api('POST', '/residents', { token: tokenA, orgId: orgA, idem: uuid(), body: { fullName: 'Sara Worker', type: 'WORKER' } });
  const resident2 = r2.body.data.id;
  const c2 = await api('POST', '/contracts', { token: tokenA, orgId: orgA, idem: uuid(), body: { hostelId, residentId: resident2, startDate: '2026-06-01', rent: { amount: 3000, currency: 'AFN' } } });
  const contract2 = c2.body.data.id;
  await api('POST', `/contracts/${contract2}/activate`, { token: tokenA, orgId: orgA });
  // DRAFT contract (not activated)
  const c3 = await api('POST', '/contracts', { token: tokenA, orgId: orgA, idem: uuid(), body: { hostelId, residentId: resident2, startDate: '2026-06-01', rent: { amount: 2500, currency: 'AFN' } } });
  const contractDraft = c3.body.data.id;
  const b4 = await mkBed('B4');
  const bed4 = b4.body.data.id;

  const a1 = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: uuid(), body: { bedId: bed1, residentId, contractId, startDate: '2026-06-01', endDate: '2026-06-10' } });
  check('assign bed1 201', a1.status === 201 && a1.body.data.status === 'ACTIVE', 's=' + a1.status);
  const a1id = a1.body.data.id;
  const aOver = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: uuid(), body: { bedId: bed1, residentId: resident2, contractId: contract2, startDate: '2026-06-05' } });
  check('overlap 409 BED_ASSIGNMENT_OVERLAP', aOver.status === 409 && aOver.body.code === 'BED_ASSIGNMENT_OVERLAP', 's=' + aOver.status);
  const aHandoff = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: uuid(), body: { bedId: bed1, residentId: resident2, contractId: contract2, startDate: '2026-06-10' } });
  check('same-day handoff allowed', aHandoff.status === 201, 's=' + aHandoff.status);
  await api('POST', `/bed-assignments/${aHandoff.body.data.id}/end`, { token: tokenA, orgId: orgA });

  const aBroken = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: uuid(), body: { bedId: bedBroken, residentId, contractId, startDate: '2026-06-01' } });
  check('broken bed assignment 409', aBroken.status === 409, 's=' + aBroken.status);
  const aDraft = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: uuid(), body: { bedId: bed2, residentId: resident2, contractId: contractDraft, startDate: '2026-06-01' } });
  check('non-active contract 409', aDraft.status === 409 && aDraft.body.code === 'CONTRACT_NOT_ACTIVE', 's=' + aDraft.status);
  const aMismatch = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: uuid(), body: { bedId: bed2, residentId, contractId: contract2, startDate: '2026-06-01' } });
  check('resident/contract mismatch 409', aMismatch.status === 409, 's=' + aMismatch.status);

  const tBlock = await api('POST', `/contracts/${contractId}/terminate`, { token: tokenA, orgId: orgA });
  check('terminate contract w/ active assignment 409', tBlock.status === 409, 's=' + tBlock.status);

  // idempotency + concurrency
  const ik = uuid();
  const aid1 = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: ik, body: { bedId: bed2, residentId, contractId, startDate: '2026-06-20' } });
  check('assign bed2 201', aid1.status === 201, 's=' + aid1.status);
  const aid2 = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: ik, body: { bedId: bed2, residentId, contractId, startDate: '2026-06-20' } });
  check('assignment idempotency replay', aid2.status === 201 && aid2.body.data.id === aid1.body.data.id, 's=' + aid2.status);
  const aid3 = await api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: ik, body: { bedId: bed2, residentId, contractId, startDate: '2026-06-21' } });
  check('assignment idempotency diff 409', aid3.status === 409, 's=' + aid3.status);

  const conc = await Promise.all([
    api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: uuid(), body: { bedId: bed4, residentId, contractId, startDate: '2026-07-01' } }),
    api('POST', '/bed-assignments', { token: tokenA, orgId: orgA, idem: uuid(), body: { bedId: bed4, residentId: resident2, contractId: contract2, startDate: '2026-07-01' } }),
  ]);
  const statuses = conc.map((x) => x.status).sort();
  check('concurrent same-bed: one 201 one 409', statuses[0] === 201 && statuses[1] === 409, 's=' + statuses.join(','));
// transfer / checkout: end A1 then terminate
  const aEnd = await api('POST', `/bed-assignments/${a1id}/end`, { token: tokenA, orgId: orgA });
  check('end assignment', aEnd.status === 200 && aEnd.body.data.status === 'ENDED', 's=' + aEnd.status);
  check('assignment endDate set (history preserved)', !!aEnd.body.data.endDate);
  const aEndAgain = await api('POST', `/bed-assignments/${a1id}/end`, { token: tokenA, orgId: orgA });
  check('end assignment idempotent', aEndAgain.status === 200, 's=' + aEndAgain.status);
  await api('POST', `/bed-assignments/${aid1.body.data.id}/end`, { token: tokenA, orgId: orgA });
  const concWin = conc.find((x) => x.status === 201);
  await api('POST', `/bed-assignments/${concWin.body.data.id}/end`, { token: tokenA, orgId: orgA });
  const tOk = await api('POST', `/contracts/${contractId}/terminate`, { token: tokenA, orgId: orgA });
  check('terminate after assignment ended', tOk.status === 200 && tOk.body.data.status === 'TERMINATED', 's=' + tOk.status);

  const tl = await api('GET', `/residents/${residentId}/timeline`, { token: tokenA, orgId: orgA });
  check('timeline returns contracts', tl.status === 200 && tl.body.data.contracts.length >= 1, 's=' + tl.status);
  check('timeline returns assignments', tl.body.data.assignments.length >= 1);
  const asgn = await api('GET', `/residents/${residentId}/assignments`, { token: tokenA, orgId: orgA });
  check('resident assignments list', asgn.status === 200 && Array.isArray(asgn.body.data) && asgn.body.data.length >= 1, 's=' + asgn.status);

  // archive: fresh resident (no contract) -> ok; resident with active contract -> 409
  const fresh = await api('POST', '/residents', { token: tokenA, orgId: orgA, idem: uuid(), body: { fullName: 'Clean Resident', type: 'OTHER' } });
  const freshId = fresh.body.data.id;
  const archOk = await api('POST', `/residents/${freshId}/archive`, { token: tokenA, orgId: orgA });
  check('archive clean resident', archOk.status === 200 && archOk.body.data.status === 'ARCHIVED', 's=' + archOk.status);
  const archBlock = await api('POST', `/residents/${resident2}/archive`, { token: tokenA, orgId: orgA });
  check('archive resident w/ active contract 409', archBlock.status === 409, 's=' + archBlock.status);
}

main().catch((e) => { console.error(e); fail++; }).finally(() => {
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
});