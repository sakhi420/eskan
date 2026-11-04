require('dotenv/config');
const { randomUUID } = require('node:crypto');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
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
const reg = (email) => api('POST', '/auth/register', {
  idem: uuid(),
  body: { email, password: 'Password123!', fullName: 'Person', organizationName: 'Org' },
});

async function main() {
  const s = Date.now();
  const ea = `a${s}@example.com`, eb = `b${s}@example.com`, ec = `c${s}@example.com`;

  const ra = await reg(ea); check('register user A', ra.status === 201, 's=' + ra.status);
  const rb = await reg(eb); check('register user B', rb.status === 201, 's=' + rb.status);
  const rc = await reg(ec); check('register user C', rc.status === 201, 's=' + rc.status);

  const tokenA = ra.body.data.accessToken, tokenB = rb.body.data.accessToken, tokenC = rc.body.data.accessToken;
  const orgA = ra.body.data.memberships[0].organizationId;
  const orgB = rb.body.data.memberships[0].organizationId;
  const userC = rc.body.data.user.id;

  const mC = await prisma.organizationMembership.create({
    data: { organizationId: orgA, userId: userC, role: 'VIEWER', active: true },
  });

  console.log('\n=== organization ===');
  const org0 = await api('GET', '/organizations/current', { token: tokenA, orgId: orgA });
  check('org current 200', org0.status === 200, 's=' + org0.status);
  check('org version=1', org0.body.data.version === 1);

  const patched = await api('PATCH', '/organizations/current', { token: tokenA, orgId: orgA, version: 1, body: { name: 'Renamed' } });
  check('org patch bumps version', patched.status === 200 && patched.body.data.version === 2);

  const stale = await api('PATCH', '/organizations/current', { token: tokenA, orgId: orgA, version: 1, body: { name: 'X' } });
  check('org patch stale -> 409', stale.status === 409 && stale.body.code === 'RESOURCE_VERSION_CONFLICT');

  const nover = await api('PATCH', '/organizations/current', { token: tokenA, orgId: orgA, body: { name: 'X' } });
  check('org patch missing version -> 422', nover.status === 422);

  const members = await api('GET', '/organizations/current/members', { token: tokenA, orgId: orgA });
  check('members list length 2', members.status === 200 && members.body.data.length === 2);

  const cpm = await api('PATCH', `/organizations/current/members/${mC.id}`, { token: tokenC, orgId: orgA, body: { role: 'ADMIN' } });
  check('viewer manage member -> 403', cpm.status === 403, 's=' + cpm.status);

  const prom = await api('PATCH', `/organizations/current/members/${mC.id}`, { token: tokenA, orgId: orgA, body: { role: 'OPERATOR' } });
  check('owner change role -> 200', prom.status === 200 && prom.body.data.role === 'OPERATOR');

  console.log('\n=== hostels ===');
  const hCreate = await api('POST', '/hostels', { token: tokenA, orgId: orgA, idem: uuid(), body: { name: 'Hostel One', address: 'Kabul' } });
  check('create hostel -> 201', hCreate.status === 201, 's=' + hCreate.status);
  const H1 = hCreate.body.data.id;

  const hNoKey = await api('POST', '/hostels', { token: tokenA, orgId: orgA, body: { name: 'NoKey' } });
  check('create hostel missing key -> 422', hNoKey.status === 422);

  const key1 = uuid();
  const hIdem1 = await api('POST', '/hostels', { token: tokenA, orgId: orgA, idem: key1, body: { name: 'Idem Hostel' } });
  const hIdem2 = await api('POST', '/hostels', { token: tokenA, orgId: orgA, idem: key1, body: { name: 'Idem Hostel' } });
  check('idempotency replay same resource', hIdem1.status === 201 && hIdem2.status === 201 && hIdem2.body.data.id === hIdem1.body.data.id);

  const hIdem3 = await api('POST', '/hostels', { token: tokenA, orgId: orgA, idem: key1, body: { name: 'Different' } });
  check('idempotency different body -> 409', hIdem3.status === 409 && hIdem3.body.code === 'IDEMPOTENCY_KEY_REUSED');

  const hList = await api('GET', '/hostels?q=Hostel', { token: tokenA, orgId: orgA });
  check('list hostels search', hList.status === 200 && hList.body.data.totalElements >= 2);

  const hGet = await api('GET', `/hostels/${H1}`, { token: tokenA, orgId: orgA });
  check('get hostel -> 200', hGet.status === 200 && hGet.body.data.name === 'Hostel One');

  const hPatch = await api('PATCH', `/hostels/${H1}`, { token: tokenA, orgId: orgA, version: 1, body: { name: 'Hostel One v2' } });
  check('update hostel bumps version', hPatch.status === 200 && hPatch.body.data.version === 2);

  const hStale = await api('PATCH', `/hostels/${H1}`, { token: tokenA, orgId: orgA, version: 1, body: { name: 'X' } });
  check('update hostel stale -> 409', hStale.status === 409 && hStale.body.code === 'RESOURCE_VERSION_CONFLICT');

  console.log('\n=== rooms ===');
  const rCreate = await api('POST', `/hostels/${H1}/rooms`, { token: tokenA, orgId: orgA, idem: uuid(), body: { code: '101', floor: 1 } });
  check('create room -> 201', rCreate.status === 201, 's=' + rCreate.status);
  const R1 = rCreate.body.data.id;

  const rDup = await api('POST', `/hostels/${H1}/rooms`, { token: tokenA, orgId: orgA, idem: uuid(), body: { code: '101', floor: 2 } });
  check('duplicate room code -> 409', rDup.status === 409 && rDup.body.code === 'DUPLICATE_CODE', 's=' + rDup.status);

  const rList = await api('GET', `/hostels/${H1}/rooms`, { token: tokenA, orgId: orgA });
  check('list rooms', rList.status === 200 && rList.body.data.totalElements === 1);

  const rGet = await api('GET', `/rooms/${R1}`, { token: tokenA, orgId: orgA });
  check('get room -> 200', rGet.status === 200 && rGet.body.data.code === '101');

  const rPatch = await api('PATCH', `/rooms/${R1}`, { token: tokenA, orgId: orgA, version: 1, body: { code: '102', floor: 1 } });
  check('update room bumps version', rPatch.status === 200 && rPatch.body.data.version === 2 && rPatch.body.data.code === '102');

  console.log('\n=== beds ===');
  const bCreate = await api('POST', `/rooms/${R1}/beds`, { token: tokenA, orgId: orgA, idem: uuid(), body: { code: 'B1' } });
  check('create bed -> 201', bCreate.status === 201, 's=' + bCreate.status);
  const B1 = bCreate.body.data.id;

  const bDup = await api('POST', `/rooms/${R1}/beds`, { token: tokenA, orgId: orgA, idem: uuid(), body: { code: 'B1' } });
  check('duplicate bed code -> 409', bDup.status === 409 && bDup.body.code === 'DUPLICATE_CODE');

  const bList = await api('GET', `/rooms/${R1}/beds`, { token: tokenA, orgId: orgA });
  check('list beds', bList.status === 200 && bList.body.data.totalElements === 1);

  const bGet = await api('GET', `/beds/${B1}`, { token: tokenA, orgId: orgA });
  check('get bed -> 200', bGet.status === 200 && bGet.body.data.code === 'B1');

  const bPatch = await api('PATCH', `/beds/${B1}`, { token: tokenA, orgId: orgA, version: 1, body: { code: 'B2' } });
  check('update bed bumps version', bPatch.status === 200 && bPatch.body.data.version === 2 && bPatch.body.data.code === 'B2');

  console.log('\n=== security: cross-tenant ===');
  const bSwitch = await api('GET', '/organizations/current', { token: tokenB, orgId: orgA });
  check('B selects org A without membership -> 403', bSwitch.status === 403, 's=' + bSwitch.status);

  const bGetA = await api('GET', `/hostels/${H1}`, { token: tokenB, orgId: orgB });
  check('B reads A hostel -> 404', bGetA.status === 404, 's=' + bGetA.status);

  const bPatchA = await api('PATCH', `/hostels/${H1}`, { token: tokenB, orgId: orgB, version: 2, body: { name: 'Hijack' } });
  check('B updates A hostel -> 404', bPatchA.status === 404);

  const bRoomInA = await api('POST', `/hostels/${H1}/rooms`, { token: tokenB, orgId: orgB, idem: uuid(), body: { code: '999', floor: 9 } });
  check('B creates room in A hostel -> 404', bRoomInA.status === 404);

  const cCreate = await api('POST', '/hostels', { token: tokenC, orgId: orgA, idem: uuid(), body: { name: 'C Hostel' } });
  check('operator cannot create hostel -> 403', cCreate.status === 403, 's=' + cCreate.status);

  const noToken = await api('GET', '/hostels', {});
  check('no token -> 401', noToken.status === 401, 's=' + noToken.status);

  console.log('\n=== business rules: archive/deactivate ===');
  const archH = await api('POST', `/hostels/${H1}/archive`, { token: tokenA, orgId: orgA });
  check('archive hostel with active room -> 409', archH.status === 409 && archH.body.code === 'RESOURCE_HAS_ACTIVE_ASSIGNMENT', 's=' + archH.status);

  const archR = await api('POST', `/rooms/${R1}/archive`, { token: tokenA, orgId: orgA });
  check('archive room with active bed -> 409', archR.status === 409 && archR.body.code === 'RESOURCE_HAS_ACTIVE_ASSIGNMENT');

  const resident = await prisma.resident.create({ data: { organizationId: orgA, fullName: 'Resident X' } });
  const contract = await prisma.stayContract.create({
    data: { organizationId: orgA, hostelId: H1, residentId: resident.id, contractNumber: 'C-' + s, startDate: new Date(), rentAmount: 1000 },
  });
  const assignment = await prisma.bedAssignment.create({
    data: { organizationId: orgA, bedId: B1, residentId: resident.id, contractId: contract.id, startDate: new Date() },
  });

  const deactBusy = await api('POST', `/beds/${B1}/deactivate`, { token: tokenA, orgId: orgA });
  check('deactivate bed with active assignment -> 409', deactBusy.status === 409 && deactBusy.body.code === 'RESOURCE_HAS_ACTIVE_ASSIGNMENT', 's=' + deactBusy.status);

  await prisma.bedAssignment.update({ where: { id: assignment.id }, data: { status: 'ENDED', endDate: new Date() } });
  const deact = await api('POST', `/beds/${B1}/deactivate`, { token: tokenA, orgId: orgA });
  check('deactivate bed -> 200 INACTIVE', deact.status === 200 && deact.body.data.status === 'INACTIVE', 's=' + deact.status);

  const archR2 = await api('POST', `/rooms/${R1}/archive`, { token: tokenA, orgId: orgA });
  check('archive room -> 200 ARCHIVED', archR2.status === 200 && archR2.body.data.status === 'ARCHIVED', 's=' + archR2.status);

  const archH2 = await api('POST', `/hostels/${H1}/archive`, { token: tokenA, orgId: orgA });
  check('archive hostel -> 200 ARCHIVED', archH2.status === 200 && archH2.body.data.status === 'ARCHIVED', 's=' + archH2.status);

  const hAfter = await api('GET', `/hostels/${H1}`, { token: tokenA, orgId: orgA });
  const rAfter = await api('GET', `/rooms/${R1}`, { token: tokenA, orgId: orgA });
  const bAfter = await api('GET', `/beds/${B1}`, { token: tokenA, orgId: orgA });
  check('archive does not delete records', hAfter.status === 200 && rAfter.status === 200 && bAfter.status === 200);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });