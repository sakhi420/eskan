'use strict';
/**
 * M-1 migration & database constraint integration tests (real PostgreSQL).
 *
 * Safety: every scenario creates a fresh throwaway database (eskan_m1_*) and
 * drops it on exit — no persistent or real database is ever modified.
 *
 * Migrations are applied by executing their raw SQL in dependency order:
 * migrations 1..8 first (the "baseline"), then the M-1 migration itself. This
 * is equivalent to `prisma migrate deploy` (each file runs as one implicit
 * transaction) but lets us seed legacy/valid/invalid data BEFORE M-1's DDL.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const M1_NAME = '20261107100000_m1_assignment_end_reason_amount_checks';

const uuid = () => crypto.randomUUID();
const rand = () => crypto.randomBytes(4).toString('hex');

function dbUrl(dbName) {
  const u = new URL(BASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}
function adminUrl() {
  const u = new URL(BASE_URL);
  u.pathname = '/postgres';
  return u.toString();
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
  } catch {
    /* best effort */
  }
}
async function freshDb(admin, tag) {
  const name = `eskan_m1_${tag}_${process.pid}_${Date.now().toString(36)}_${rand()}`;
  await createDb(admin, name);
  const client = new Client({ connectionString: dbUrl(name) });
  await client.connect();
  return { name, client };
}

async function seedBase(c) {
  const org = uuid(), hostel = uuid(), room = uuid(), bed = uuid(), resident = uuid();
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`, [hostel, org]);
  await c.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'R1',1,now())`, [room, org, hostel]);
  await c.query(`INSERT INTO beds (id, organization_id, room_id, code, updated_at) VALUES ($1,$2,$3,'B1',now())`, [bed, org, room]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
  return { org, hostel, room, bed, resident };
}

async function scenarioValidBaselineAndChecks(admin) {
  const { client: c, name } = await freshDb(admin, 'valid');
  try {
    const migrations = readMigrations();
    const beforeM1 = migrations.filter((m) => m.name !== M1_NAME);
    const m1 = migrations.find((m) => m.name === M1_NAME);

    for (const m of beforeM1) await c.query(m.sql);
    check('[valid] baseline migrations 1..8 applied', true, `${beforeM1.length} migrations`);

    const ids = await seedBase(c);
    const user = uuid(), contract = uuid(), ba = uuid();
    await c.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,'m1@example.com','h','M1',now())`, [user]);
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, deposit_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-VALID','ACTIVE','2020-01-01',5000,1000,now())`, [contract, ids.org, ids.hostel, ids.resident]);
    await c.query(`INSERT INTO bed_assignments (id, organization_id, bed_id, resident_id, contract_id, status, start_date, updated_at) VALUES ($1,$2,$3,$4,$5,'ACTIVE','2020-01-01',now())`, [ba, ids.org, ids.bed, ids.resident, contract]);
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',1500,'2020-01-01','2020-01-31','2020-01-01',now())`, [uuid(), ids.org, ids.resident]);
    await c.query(`INSERT INTO payments (id, organization_id, resident_id, method, received_at, receipt_number, amount, updated_at) VALUES ($1,$2,$3,'CASH','2020-01-02','RCP-1',2000,now())`, [uuid(), ids.org, ids.resident]);
    await c.query(`INSERT INTO expenses (id, organization_id, hostel_id, category, amount, spent_at, updated_at) VALUES ($1,$2,$3,'FOOD',300,'2020-01-03',now())`, [uuid(), ids.org, ids.hostel]);
    await c.query(`INSERT INTO deposit_transactions (id, organization_id, resident_id, type, amount, received_at, updated_at) VALUES ($1,$2,$3,'RECEIVED',500,'2020-01-01',now())`, [uuid(), ids.org, ids.resident]);
    await c.query(`INSERT INTO manual_subscription_payments (id, organization_id, amount, method, received_at, verified_by_user_id, updated_at) VALUES ($1,$2,250,'CASH','2020-01-01',$3,now())`, [uuid(), ids.org, user]);

    await c.query(m1.sql);
    check('[valid] M-1 migration succeeded on non-empty baseline', true);

    const enumT = await c.query(`SELECT 1 FROM pg_type WHERE typname='AssignmentEndReason'`);
    check('[valid] AssignmentEndReason enum exists', enumT.rowCount === 1);
    const labels = await c.query(`SELECT count(*)::int n FROM pg_enum WHERE enumtypid=(SELECT oid FROM pg_type WHERE typname='AssignmentEndReason')`);
    check('[valid] AssignmentEndReason has 4 labels', labels.rows[0].n === 4, `count=${labels.rows[0].n}`);

    const col = await c.query(`SELECT is_nullable, data_type FROM information_schema.columns WHERE table_name='bed_assignments' AND column_name='end_reason'`);
    check('[valid] bed_assignments.end_reason column added', col.rowCount === 1);
    const legacy = await c.query(`SELECT end_reason FROM bed_assignments WHERE id=$1`, [ba]);
    check('[valid] legacy end_reason is NULL (not rewritten)', legacy.rows[0].end_reason === null);

    const constraints = ['stay_contracts_rent_positive', 'stay_contracts_deposit_nonnegative', 'charges_amount_positive', 'payments_amount_positive', 'payment_allocations_amount_positive', 'deposit_transactions_amount_positive', 'expenses_amount_positive', 'manual_subscription_payments_amount_positive'];
    for (const cn of constraints) {
      const r = await c.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [cn]);
      check(`[valid] constraint ${cn} exists`, r.rowCount === 1);
    }

    const rent = await c.query(`SELECT rent_amount, deposit_amount FROM stay_contracts WHERE id=$1`, [contract]);
    check('[valid] baseline data unchanged', rent.rows[0].rent_amount === 5000 && rent.rows[0].deposit_amount === 1000);

const { org, hostel, resident } = ids;
    check('[check] charge amount=0 rejected (23514)', (await expectErr(c, `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',0,'2020-01-01','2020-01-31','2020-01-01',now())`, [uuid(), org, resident])) === '23514');
    check('[check] charge amount=-1 rejected (23514)', (await expectErr(c, `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',-1,'2020-01-01','2020-01-31','2020-01-01',now())`, [uuid(), org, resident])) === '23514');
    check('[check] charge amount=2147483648 out of int32 (22003)', (await expectErr(c, `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',2147483648,'2020-01-01','2020-01-31','2020-01-01',now())`, [uuid(), org, resident])) === '22003');
    check('[check] payment amount=0 rejected (23514)', (await expectErr(c, `INSERT INTO payments (id, organization_id, resident_id, method, received_at, receipt_number, amount, updated_at) VALUES ($1,$2,$3,'CASH','2020-01-02','RCP-Z',0,now())`, [uuid(), org, resident])) === '23514');
    check('[check] expense amount=0 rejected (23514)', (await expectErr(c, `INSERT INTO expenses (id, organization_id, hostel_id, category, amount, spent_at, updated_at) VALUES ($1,$2,$3,'FOOD',0,'2020-01-03',now())`, [uuid(), org, hostel])) === '23514');
    check('[check] deposit_transaction amount=0 rejected (23514)', (await expectErr(c, `INSERT INTO deposit_transactions (id, organization_id, resident_id, type, amount, received_at, updated_at) VALUES ($1,$2,$3,'RECEIVED',0,'2020-01-01',now())`, [uuid(), org, resident])) === '23514');
    check('[check] manual_payment amount=-1 rejected (23514)', (await expectErr(c, `INSERT INTO manual_subscription_payments (id, organization_id, amount, method, received_at, verified_by_user_id, updated_at) VALUES ($1,$2,-1,'CASH','2020-01-01',$3,now())`, [uuid(), org, user])) === '23514');
    check('[check] stay_contracts.rent=0 rejected (23514)', (await expectErr(c, `UPDATE stay_contracts SET rent_amount=0 WHERE id=$1`, [contract])) === '23514');
    check('[check] stay_contracts.rent=-5 rejected (23514)', (await expectErr(c, `UPDATE stay_contracts SET rent_amount=-5 WHERE id=$1`, [contract])) === '23514');
    check('[check] stay_contracts.deposit=-1 rejected (23514)', (await expectErr(c, `UPDATE stay_contracts SET deposit_amount=-1 WHERE id=$1`, [contract])) === '23514');
    check('[check] stay_contracts.deposit=0 allowed', (await expectErr(c, `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, deposit_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-D0','DRAFT','2020-01-01',5000,0,now())`, [uuid(), org, hostel, resident])) === null);

    const ch = uuid(), pay = uuid();
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',1000,'2020-01-01','2020-01-31','2020-01-01',now())`, [ch, org, resident]);
    await c.query(`INSERT INTO payments (id, organization_id, resident_id, method, received_at, receipt_number, amount, updated_at) VALUES ($1,$2,$3,'CASH','2020-01-02','RCP-A',1000,now())`, [pay, org, resident]);
    check('[check] payment_allocation amount=0 rejected (23514)', (await expectErr(c, `INSERT INTO payment_allocations (id, payment_id, charge_id, amount) VALUES ($1,$2,$3,0)`, [uuid(), pay, ch])) === '23514');
  } finally {
    await c.end().catch(() => {});
    await dropDb(admin, name);
  }
}

async function scenarioPreflightFailure(admin) {
  const { client: c, name } = await freshDb(admin, 'preflight');
  try {
    const migrations = readMigrations();
    for (const m of migrations.filter((m) => m.name !== M1_NAME)) await c.query(m.sql);
    const m1 = migrations.find((m) => m.name === M1_NAME);

    const ids = await seedBase(c);
    const contract = uuid(), charge = uuid();
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-BAD','ACTIVE','2020-01-01',0,now())`, [contract, ids.org, ids.hostel, ids.resident]);
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',-1,'2020-01-01','2020-01-31','2020-01-01',now())`, [charge, ids.org, ids.resident]);

    let err = null;
    try {
      await c.query(m1.sql);
    } catch (e) {
      err = e;
      await c.query('ROLLBACK');
    }
    check('[preflight] M-1 raised an exception', !!err);
    const msg = String((err && err.message) || err);
    check('[preflight] error reports contracts=1 charges=1', msg.includes('contracts=1') && msg.includes('charges=1'), msg.slice(0, 140));

    check('[preflight] AssignmentEndReason enum NOT created', (await c.query(`SELECT 1 FROM pg_type WHERE typname='AssignmentEndReason'`)).rowCount === 0);
    check('[preflight] bed_assignments.end_reason NOT added', (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='bed_assignments' AND column_name='end_reason'`)).rowCount === 0);
    check('[preflight] stay_contracts_rent_positive NOT added', (await c.query(`SELECT 1 FROM pg_constraint WHERE conname='stay_contracts_rent_positive'`)).rowCount === 0);
    check('[preflight] charges_amount_positive NOT added', (await c.query(`SELECT 1 FROM pg_constraint WHERE conname='charges_amount_positive'`)).rowCount === 0);

    const rentAfter = await c.query(`SELECT rent_amount FROM stay_contracts WHERE id=$1`, [contract]);
    const chargeAfter = await c.query(`SELECT amount FROM charges WHERE id=$1`, [charge]);
    check('[preflight] invalid data unchanged (rent 0 / charge -1)', rentAfter.rows[0].rent_amount === 0 && chargeAfter.rows[0].amount === -1);
  } finally {
    await c.end().catch(() => {});
    await dropDb(admin, name);
  }
}

(async () => {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await scenarioValidBaselineAndChecks(admin);
    await scenarioPreflightFailure(admin);
  } finally {
    await admin.end().catch(() => {});
  }
  console.log('\n' + results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M-1 migration & constraint checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});