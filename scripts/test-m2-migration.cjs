'use strict';
/**
 * M-2 migration & database constraint integration tests (real PostgreSQL).
 * Safety: every scenario creates a fresh throwaway database and drops it on exit.
 *
 * Scenarios:
 *   - empty DB      : apply ALL migrations, verify M-2 artifacts.
 *   - baseline+data : seed consistent multi-tenant + package + allocation data,
 *                     apply M-2, verify backfill.
 *   - negative FK   : cross-org / cross-resident / package-hostel inserts are
 *                     REJECTED by PostgreSQL (23503 / 23514).
 *   - preflight fail: seed a cross-org anomaly pre-M-2 → migration rolls back.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const M2_NAME = '20261107120000_m2_tenant_resident_composite_integrity';

const uuid = () => crypto.randomUUID();
const rand = () => crypto.randomBytes(4).toString('hex');

function dbUrl(name) {
  const u = new URL(BASE_URL);
  u.pathname = `/${name}`;
  return u.toString();
}
function adminUrl() {
  const u = new URL(BASE_URL);
  u.pathname = '/postgres';
  return u.toString();
}

function assertLocalTestHost() {
  let host = '', db = '';
  try {
    const u = new URL(BASE_URL);
    host = u.hostname;
    db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {}
  const okHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  const okDb = ['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db);
  if ((!okHost || !okDb) && process.env.ESKAN_TEST_DB_ALLOW !== '1') {
    console.error(
      `REFUSED: this script creates/drops throwaway (eskan_m2_*) databases. host="${host}" db="${db}" is not ` +
        `a local dev/test database. Set ESKAN_TEST_DB_ALLOW=1 to override for an explicitly sanctioned test server.`,
    );
    process.exit(2);
  }
}

function readMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8') }));
}

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' - ' + extra : ''}`);

async function expectErr(client, query, params) {
  try {
    await client.query(query, params);
    return null;
  } catch (e) {
    return e.code;
  }
}

async function createDb(admin, name) {
  await admin.query(`CREATE DATABASE "${name}"`);
}
async function dropDb(admin, name) {
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } catch {}
}
async function freshDb(admin, tag) {
  const name = `eskan_m2_${tag}_${process.pid}_${Date.now().toString(36)}_${rand()}`;
  await createDb(admin, name);
  const client = new Client({ connectionString: dbUrl(name) });
  await client.connect();
  return { name, client };
}

function applyBefore(client, beforeName) {
  return readMigrations()
    .filter((m) => m.name < beforeName)
    .reduce((p, m) => p.then(() => client.query(m.sql)), Promise.resolve());
}

function applyAll(client) {
  return readMigrations().reduce((p, m) => p.then(() => client.query(m.sql)), Promise.resolve());
}

// Seed a consistent accommodation hierarchy + package + payment/charge/allocation.
async function seedBaseline(c) {
  const ids = {
    orgA: uuid(), orgB: uuid(), hostelA: uuid(), hostelB: uuid(), roomA: uuid(), bedA: uuid(),
    residentA: uuid(), residentB: uuid(), contractA: uuid(), pkgA: uuid(), payA: uuid(), chargeA: uuid(), allocA: uuid(),
  };
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'OrgA',now()),($2,'OrgB',now())`, [ids.orgA, ids.orgB]);
  await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'HA',now()),($3,$4,'HB',now())`, [ids.hostelA, ids.orgA, ids.hostelB, ids.orgB]);
  await c.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'R1',1,now())`, [ids.roomA, ids.orgA, ids.hostelA]);
  await c.query(`INSERT INTO beds (id, organization_id, room_id, code, updated_at) VALUES ($1,$2,$3,'B1',now())`, [ids.bedA, ids.orgA, ids.roomA]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RA',now()),($3,$2,'RB',now())`, [ids.residentA, ids.orgA, ids.residentB]);
  await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-M2','ACTIVE','2020-01-01',5000,now())`, [ids.contractA, ids.orgA, ids.hostelA, ids.residentA]);
  await c.query(`INSERT INTO accommodation_packages (id, organization_id, hostel_id, name, created_at, updated_at) VALUES ($1,$2,$3,'PKG',now(),now())`, [ids.pkgA, ids.orgA, ids.hostelA]);
  await c.query(`INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at) VALUES ($1,$2,$3,1000,'CASH','2020-01-02','RCP-M2',now())`, [ids.payA, ids.orgA, ids.residentA]);
  await c.query(`INSERT INTO charges (id, organization_id, resident_id, contract_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,$4,'RENT',500,'2020-01-01','2020-01-31','2020-01-01',now())`, [ids.chargeA, ids.orgA, ids.residentA, ids.contractA]);
  await c.query(`INSERT INTO payment_allocations (id, payment_id, charge_id, amount) VALUES ($1,$2,$3,500)`, [ids.allocA, ids.payA, ids.chargeA]);
  return ids;
}

async function seedNegatives(c) {
  const d = {};
  d.orgA = uuid(); d.orgB = uuid();
  d.hostelA = uuid(); d.hostelA2 = uuid(); d.hostelB = uuid();
  d.roomA = uuid(); d.bedA = uuid();
  d.resA = uuid(); d.resA2 = uuid(); d.resB = uuid();
  d.cntA = uuid(); d.cntB = uuid(); d.pkgA = uuid(); d.pkgB = uuid();
  d.payA = uuid(); d.chgA = uuid(); d.chgB = uuid();
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'A',now()),($2,'B',now())`, [d.orgA, d.orgB]);
  await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'HA',now()),($3,$2,'HA2',now()),($4,$5,'HB',now())`, [d.hostelA, d.orgA, d.hostelA2, d.hostelB, d.orgB]);
  await c.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'R',1,now())`, [d.roomA, d.orgA, d.hostelA]);
  await c.query(`INSERT INTO beds (id, organization_id, room_id, code, updated_at) VALUES ($1,$2,$3,'B',now())`, [d.bedA, d.orgA, d.roomA]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RA',now()),($3,$2,'RA2',now()),($4,$5,'RB',now())`, [d.resA, d.orgA, d.resA2, d.resB, d.orgB]);
  await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-A','ACTIVE','2020-01-01',5000,now())`, [d.cntA, d.orgA, d.hostelA, d.resA]);
  await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-B','ACTIVE','2020-01-01',5000,now())`, [d.cntB, d.orgB, d.hostelB, d.resB]);
  await c.query(`INSERT INTO accommodation_packages (id, organization_id, hostel_id, name, created_at, updated_at) VALUES ($1,$2,$3,'P',now(),now()),($4,$5,NULL,'PB',now(),now())`, [d.pkgA, d.orgA, d.hostelA, d.pkgB, d.orgB]);
  await c.query(`INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at) VALUES ($1,$2,$3,1000,'CASH','2020-01-02','RP',now())`, [d.payA, d.orgA, d.resA]);
  await c.query(`INSERT INTO charges (id, organization_id, resident_id, contract_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,$4,'RENT',500,'2020-01-01','2020-01-31','2020-01-01',now()),($5,$6,$7,$8,'RENT',500,'2020-01-01','2020-01-31','2020-01-01',now())`, [d.chgA, d.orgA, d.resA, d.cntA, d.chgB, d.orgB, d.resB, d.cntB]);
  return d;
}

async function scenarioEmptyDb(admin) {
  const { client: c, name } = await freshDb(admin, 'empty');
  try {
    await applyAll(c);
    check('[empty] M-2 migration applied on empty DB', true);
    const keys = [
      'hostels_organization_id_id_key', 'rooms_organization_id_id_key', 'beds_organization_id_id_key',
      'residents_organization_id_id_key', 'stay_contracts_organization_id_id_key',
      'stay_contracts_organization_id_resident_id_id_key', 'charges_organization_id_id_key',
      'charges_organization_id_resident_id_id_key', 'payments_organization_id_id_key',
      'payments_organization_id_resident_id_id_key', 'temporary_absences_organization_id_resident_id_id_key',
      'accommodation_packages_organization_id_id_key',
    ];
    for (const k of keys) {
      check(`[empty] unique index ${k}`, (await c.query(`SELECT 1 FROM pg_class WHERE relname=$1 AND relkind='i'`, [k])).rowCount === 1);
    }
    const fks = [
      'rooms_organization_id_hostel_id_fkey',
      'beds_organization_id_room_id_fkey',
      'accommodation_packages_organization_id_hostel_id_fkey',
      'temporary_absences_organization_id_resident_id_fkey',
      'temporary_absences_organization_id_resident_id_contract_id_fkey',
      'temporary_absences_organization_id_resident_id_credit_char_fkey',
      'stay_contracts_organization_id_hostel_id_fkey',
      'stay_contracts_organization_id_resident_id_fkey',
      'stay_contracts_organization_id_package_id_fkey',
      'bed_assignments_organization_id_bed_id_fkey',
      'bed_assignments_organization_id_resident_id_fkey',
      'bed_assignments_organization_id_resident_id_contract_id_fkey',
      'charges_organization_id_resident_id_fkey',
      'charges_organization_id_resident_id_contract_id_fkey',
      'payments_organization_id_resident_id_fkey',
      'payment_allocations_organization_id_resident_id_payment_id_fkey',
      'payment_allocations_organization_id_resident_id_charge_id_fkey',
      'deposit_transactions_organization_id_resident_id_fkey',
      'expenses_organization_id_hostel_id_fkey',
    ];
    for (const f of fks) {
      check(`[empty] composite FK ${f}`, (await c.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [f])).rowCount === 1);
    }
    // NULLABLE-parent relations keep their single-column SET NULL FK.
    const singleNullFks = ['stay_contracts_package_id_fkey', 'charges_contract_id_fkey',
      'temporary_absences_credit_charge_id_fkey', 'expenses_hostel_id_fkey', 'accommodation_packages_hostel_id_fkey'];
    for (const f of singleNullFks) {
      check(`[empty] SET NULL single FK preserved ${f}`, (await c.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [f])).rowCount === 1);
    }
    // NOT-NULL relations' old single-column FKs are replaced (dropped).
    const droppedOld = ['rooms_hostel_id_fkey', 'beds_room_id_fkey', 'stay_contracts_hostel_id_fkey',
      'stay_contracts_resident_id_fkey', 'bed_assignments_bed_id_fkey', 'bed_assignments_resident_id_fkey',
      'bed_assignments_contract_id_fkey', 'charges_resident_id_fkey', 'payments_resident_id_fkey',
      'deposit_transactions_resident_id_fkey', 'temporary_absences_resident_id_fkey',
      'temporary_absences_contract_id_fkey', 'payment_allocations_payment_id_fkey',
      'payment_allocations_charge_id_fkey'];
    for (const f of droppedOld) {
      check(`[empty] old single-column FK dropped ${f}`, (await c.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [f])).rowCount === 0);
    }
    const idx = ['rooms_organization_id_hostel_id_idx', 'beds_organization_id_room_id_idx',
      'stay_contracts_organization_id_package_id_idx', 'bed_assignments_organization_id_resident_id_contract_id_idx',
      'charges_organization_id_resident_id_contract_id_idx', 'expenses_organization_id_hostel_id_idx',
      'temporary_absences_organization_id_resident_id_contract_id_idx',
      'temporary_absences_organization_id_resident_id_credit_charg_idx',
      'payment_allocations_organization_id_resident_id_payment_id_idx',
      'payment_allocations_organization_id_resident_id_charge_id_idx'];
    for (const i of idx) {
      check(`[empty] child FK index ${i}`, (await c.query(`SELECT 1 FROM pg_class WHERE relname=$1 AND relkind='i'`, [i])).rowCount === 1);
    }
    check('[empty] payment_allocations (payment_id, charge_id) unique dropped', (await c.query(`SELECT 1 FROM pg_class WHERE relname='payment_allocations_payment_id_charge_id_key'`)).rowCount === 0);
    const cols = await c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='payment_allocations' AND column_name IN ('organization_id','resident_id') ORDER BY column_name`);
    check('[empty] payment_allocations org/resident NOT NULL', cols.rows.length === 2 && cols.rows.every((r) => r.is_nullable === 'NO'));
    check('[empty] trigger stay_contracts_package_hostel_check', (await c.query(`SELECT 1 FROM pg_trigger WHERE tgname='stay_contracts_package_hostel_check'`)).rowCount === 1);
    check('[empty] trigger accommodation_packages_hostel_change_check', (await c.query(`SELECT 1 FROM pg_trigger WHERE tgname='accommodation_packages_hostel_change_check'`)).rowCount === 1);
  } finally {
    await c.end().catch(() => {});
    await dropDb(admin, name);
  }
}

async function scenarioBaselineWithData(admin) {
  const { client: c, name } = await freshDb(admin, 'data');
  try {
    await applyBefore(c, M2_NAME);
    const ids = await seedBaseline(c);
    const m2 = readMigrations().find((m) => m.name === M2_NAME);
    await c.query(m2.sql);
    check('[data] M-2 migration succeeded on non-empty baseline', true);
    const alloc = await c.query(`SELECT organization_id, resident_id FROM payment_allocations WHERE id=$1`, [ids.allocA]);
    check('[data] payment_allocation backfilled from payment', alloc.rows[0].organization_id === ids.orgA && alloc.rows[0].resident_id === ids.residentA);
    check('[data] single-column package FK preserved', (await c.query(`SELECT 1 FROM pg_constraint WHERE conname='stay_contracts_package_id_fkey'`)).rowCount === 1);
    check('[data] single-column credit_charge FK preserved', (await c.query(`SELECT 1 FROM pg_constraint WHERE conname='temporary_absences_credit_charge_id_fkey'`)).rowCount === 1);
    check('[data] unit package data still present', (await c.query(`SELECT count(*)::int n FROM accommodation_packages`)).rows[0].n === 1);
  } finally {
    await c.end().catch(() => {});
    await dropDb(admin, name);
  }
}

async function scenarioNegativeFkReject(admin) {
  const { client: c, name } = await freshDb(admin, 'neg');
  try {
    await applyAll(c);
    const d = await seedNegatives(c);
    check('[neg] cross-org room rejected (23503)', (await expectErr(c,
      `INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'X',1,now())`, [uuid(), d.orgA, d.hostelB])) === '23503');
    check('[neg] cross-resident assignment rejected (23503)', (await expectErr(c,
      `INSERT INTO bed_assignments (id, organization_id, bed_id, resident_id, contract_id, status, start_date, updated_at) VALUES ($1,$2,$3,$4,$5,'ACTIVE','2020-02-01',now())`, [uuid(), d.orgA, d.bedA, d.resA2, d.cntA])) === '23503');
    check('[neg] cross-org charge rejected (23503)', (await expectErr(c,
      `INSERT INTO charges (id, organization_id, resident_id, contract_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,$4,'RENT',100,'2020-01-01','2020-01-31','2020-01-01',now())`, [uuid(), d.orgA, d.resB, d.cntB])) === '23503');
    check('[neg] cross-org package rejected (23503)', (await expectErr(c,
      `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, package_id, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-PKG',$5,'DRAFT','2020-02-01',5000,now())`, [uuid(), d.orgA, d.hostelA, d.resA, d.pkgB])) === '23503');
    check('[neg] package-hostel mismatch rejected (23514)', (await expectErr(c,
      `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, package_id, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-HP',$5,'ACTIVE','2020-02-01',5000,now())`, [uuid(), d.orgA, d.hostelA2, d.resA, d.pkgA])) === '23514');
    check('[neg] allocation cross-resident rejected (23503)', (await expectErr(c,
      `INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount) VALUES ($1,$2,$3,$4,$5,100)`, [uuid(), d.orgA, d.resA, d.payA, d.chgB])) === '23503');
  } finally {
    await c.end().catch(() => {});
    await dropDb(admin, name);
  }
}

async function scenarioPreflightFailure(admin) {
  const { client: c, name } = await freshDb(admin, 'preflight');
  try {
    await applyBefore(c, M2_NAME);
    const orgA = uuid(), orgB = uuid(), hostelB = uuid();
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'A',now()),($2,'B',now())`, [orgA, orgB]);
    await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'HB',now())`, [hostelB, orgB]);
    // Cross-org anomaly: a room in orgA pointing at hostelB (orgB). The
    // single-column hostel FK permits it; M-2's preflight must abort it.
    await c.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'BAD',1,now())`, [uuid(), orgA, hostelB]);

    const m2 = readMigrations().find((m) => m.name === M2_NAME);
    let err = null;
    try {
      await c.query(m2.sql);
    } catch (e) {
      err = e;
      await c.query('ROLLBACK').catch(() => {});
    }
    check('[preflight] M-2 raised an exception on cross-org data', !!err);
    const msg = String((err && err.message) || err);
    check('[preflight] error reports room_hostel=1', msg.includes('room_hostel=1'), msg.slice(0, 160));

    // No partial schema left behind after the rollback.
    check('[preflight] unique index NOT created', (await c.query(`SELECT 1 FROM pg_class WHERE relname='hostels_organization_id_id_key'`)).rowCount === 0);
    check('[preflight] payment_allocations org column NOT added', (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='payment_allocations' AND column_name='organization_id'`)).rowCount === 0);
    check('[preflight] composite FK NOT added', (await c.query(`SELECT 1 FROM pg_constraint WHERE conname='rooms_organization_id_hostel_id_fkey'`)).rowCount === 0);
    check('[preflight] trigger NOT added', (await c.query(`SELECT 1 FROM pg_trigger WHERE tgname='stay_contracts_package_hostel_check'`)).rowCount === 0);
    // Original data untouched.
    const rooms = await c.query(`SELECT count(*)::int n FROM rooms`);
    check('[preflight] invalid row unchanged', rooms.rows[0].n === 1);
  } finally {
    await c.end().catch(() => {});
    await dropDb(admin, name);
  }
}

async function scenarioOnDeleteBehavior(admin) {
  const { client: c, name } = await freshDb(admin, 'ondelete');
  try {
    await applyAll(c);
    const o = uuid(), h1 = uuid(), h2 = uuid();
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'O',now())`, [o]);
    await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H1',now()),($3,$2,'H2',now())`, [h1, o, h2]);

    // SET NULL — Expense -> Hostel (nullable), org preserved.
    const exp = uuid();
    await c.query(`INSERT INTO expenses (id, organization_id, hostel_id, category, status, amount, spent_at, updated_at) VALUES ($1,$2,$3,'X','POSTED',10,'2020-01-01',now())`, [exp, o, h1]);
    await c.query(`DELETE FROM hostels WHERE id=$1`, [h1]);
    const e = await c.query(`SELECT hostel_id, organization_id FROM expenses WHERE id=$1`, [exp]);
    check('[ondelete] expense.hostel SET NULL + org preserved', e.rows[0].hostel_id === null && e.rows[0].organization_id === o);

    // SET NULL — StayContract -> Package (nullable, hostel-specific).
    const pkg = uuid();
    await c.query(`INSERT INTO accommodation_packages (id, organization_id, hostel_id, name, created_at, updated_at) VALUES ($1,$2,$3,'P',now(),now())`, [pkg, o, h2]);
    const res = uuid(), res2 = uuid();
    await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now()),($3,$2,'R2',now())`, [res, o, res2]);
    const cnt = uuid();
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, package_id, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'C1',$5,'ACTIVE','2020-01-01',100,now())`, [cnt, o, h2, res, pkg]);
    await c.query(`DELETE FROM accommodation_packages WHERE id=$1`, [pkg]);
    check('[ondelete] stay_contract.package SET NULL', (await c.query(`SELECT package_id FROM stay_contracts WHERE id=$1`, [cnt])).rows[0].package_id === null);

    // SET NULL — Charge -> StayContract (nullable).
    const cnt2 = uuid();
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'C2','ACTIVE','2020-01-01',100,now())`, [cnt2, o, h2, res2]);
    const chg = uuid();
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, contract_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,$4,'ADJUSTMENT',100,'2020-01-01','2020-01-31','2020-01-01',now())`, [chg, o, res2, cnt2]);
    await c.query(`DELETE FROM stay_contracts WHERE id=$1`, [cnt2]);
    check('[ondelete] charge.contract SET NULL', (await c.query(`SELECT contract_id FROM charges WHERE id=$1`, [chg])).rows[0].contract_id === null);

    // New M3a invariant: a RENT charge is anchored to its contract (business
    // key). Deleting that contract would SET NULL the RENT's contract_id and
    // violate charges_rent_requires_contract, so the delete is rejected.
    const cntRent = uuid();
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'C-RENT','ACTIVE','2020-01-01',100,now())`, [cntRent, o, h2, res2]);
    const rentChg = uuid();
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, contract_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,$4,'RENT',100,'2020-02-01','2020-02-28','2020-02-01',now())`, [rentChg, o, res2, cntRent]);
    check('[ondelete] RENT charge blocks contract delete (23514)', (await expectErr(c, `DELETE FROM stay_contracts WHERE id=$1`, [cntRent])) === '23514');

    // SET NULL — TemporaryAbsence -> Charge (creditCharge, nullable).
    const usr = uuid();
    await c.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,'u@x.test','h','U',now())`, [usr]);
    const credit = uuid();
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'ADJUSTMENT',50,'2020-01-01','2020-01-31','2020-01-01',now())`, [credit, o, res]);
    const abs = uuid();
    await c.query(`INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, status, planned_departure_date, expected_return_date, requested_by_user_id, credit_charge_id, updated_at) VALUES ($1,$2,$3,$4,'APPROVED','2020-01-05','2020-01-10',$5,$6,now())`, [abs, o, res, cnt, usr, credit]);
    await c.query(`DELETE FROM charges WHERE id=$1`, [credit]);
    check('[ondelete] temporary_absence.creditCharge SET NULL', (await c.query(`SELECT credit_charge_id FROM temporary_absences WHERE id=$1`, [abs])).rows[0].credit_charge_id === null);

    // D-18 immutability — Payment -> PaymentAllocation is RESTRICT (and a BEFORE
    // DELETE trigger hardens payments): deleting a payment that has an allocation
    // is blocked and the allocation is preserved.
    const pay = uuid();
    await c.query(`INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at) VALUES ($1,$2,$3,100,'CASH','2020-01-02','R1',now())`, [pay, o, res]);
    const target = uuid();
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, contract_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,$4,'RENT',100,'2020-02-01','2020-02-28','2020-02-01',now())`, [target, o, res, cnt]);
    const alloc = uuid();
    await c.query(`INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount) VALUES ($1,$2,$3,$4,$5,100)`, [alloc, o, res, pay, target]);
    const errPayDelete = await expectErr(c, `DELETE FROM payments WHERE id=$1`, [pay]);
    check('[ondelete] payment delete blocked (immutable)', ['P0001', '23503'].includes(errPayDelete), 'code=' + errPayDelete);
    check('[ondelete] payment_allocations preserved on blocked payment delete', (await c.query(`SELECT 1 FROM payment_allocations WHERE id=$1`, [alloc])).rowCount === 1);

    // RESTRICT — Resident with a charge cannot be deleted.
    const errRes = await expectErr(c, `DELETE FROM residents WHERE id=$1`, [res]);
    check('[ondelete] resident with charge RESTRICT (23503)', errRes === '23503');

    // RESTRICT — Hostel with a room (NOT NULL child) cannot be deleted.
    const rm = uuid();
    await c.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'Rm',1,now())`, [rm, o, h2]);
    const errHostel = await expectErr(c, `DELETE FROM hostels WHERE id=$1`, [h2]);
    check('[ondelete] hostel with room RESTRICT (23503)', errHostel === '23503');
  } finally {
    await c.end().catch(() => {});
    await dropDb(admin, name);
  }
}

async function scenarioPackageHostelChange(admin) {
  const { client: c, name } = await freshDb(admin, 'pkgchange');
  try {
    await applyAll(c);
    const o = uuid(), h1 = uuid(), h2 = uuid();
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'O',now())`, [o]);
    await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H1',now()),($3,$2,'H2',now())`, [h1, o, h2]);
    const pkg = uuid();
    await c.query(`INSERT INTO accommodation_packages (id, organization_id, hostel_id, name, created_at, updated_at) VALUES ($1,$2,$3,'P',now(),now())`, [pkg, o, h1]);
    const res = uuid();
    await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [res, o]);
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, package_id, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'C',$5,'ACTIVE','2020-01-01',100,now())`, [uuid(), o, h1, res, pkg]);

    // Trigger #2: repointing a hostel-specific package to a different hostel,
    // while a live contract references it from the old hostel, is rejected.
    check('[pkg-change] repoint package to conflicting hostel rejected (23514)',
      (await expectErr(c, `UPDATE accommodation_packages SET hostel_id=$2, updated_at=now() WHERE id=$1`, [pkg, h2])) === '23514');

    // Trigger #2: repointing the package to NULL (global package) is allowed.
    await c.query(`UPDATE accommodation_packages SET hostel_id=NULL, updated_at=now() WHERE id=$1`, [pkg]);
    check('[pkg-change] repoint package to NULL (global) allowed',
      (await c.query(`SELECT hostel_id FROM accommodation_packages WHERE id=$1`, [pkg])).rows[0].hostel_id === null);
  } finally {
    await c.end().catch(() => {});
    await dropDb(admin, name);
  }
}

(async () => {
  assertLocalTestHost();
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await scenarioEmptyDb(admin);
    await scenarioBaselineWithData(admin);
    await scenarioNegativeFkReject(admin);
    await scenarioPreflightFailure(admin);
    await scenarioOnDeleteBehavior(admin);
    await scenarioPackageHostelChange(admin);
  } finally {
    await admin.end().catch(() => {});
  }
  console.log('\n' + results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M-2 migration & constraint checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});