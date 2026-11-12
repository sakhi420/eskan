'use strict';
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');
const uuid = () => crypto.randomUUID();
const dbUrl = (name) => { const u = new URL(BASE_URL); u.pathname = `/${name}`; return u.toString(); };
const adminUrl = () => { const u = new URL(BASE_URL); u.pathname = '/postgres'; return u.toString(); };

function assertLocalTestHost() {
  let host = '', db = '';
  try { const u = new URL(BASE_URL); host = u.hostname; db = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch {}
  const ok = ['localhost', '127.0.0.1', '::1'].includes(host) && ['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db);
  if (!ok && process.env.ESKAN_TEST_DB_ALLOW !== '1') { console.error('REFUSED: not a local dev/test database.'); process.exit(2); }
}
function readMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8') }));
}
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' - ' + extra : ''}`);
async function errCode(c, sql, params = []) { try { await c.query(sql, params); return null; } catch (e) { return e.code || String(e.message); } }
async function newDb(admin, tag) {
  const name = `eskan_m3c_${tag}_${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const c = new Client({ connectionString: dbUrl(name) });
  await c.connect();
  return { name, c };
}
async function applyMigrations(c, list) { for (const m of list) await c.query(m.sql); }
async function seedOrgRes(c) {
  const org = uuid(), user = uuid(), res = uuid();
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await c.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`, [user, `u-${uuid().slice(0, 8)}@e.com`]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [res, org]);
  return { org, user, res };
}
async function seedCharge(c, org, res, amount) {
  const id = uuid();
  await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER',$4,'2026-11-01','2026-12-01','2026-11-01',now())`, [id, org, res, amount]);
  return id;
}
async function seedPayment(c, org, res, amount) {
  const id = uuid();
  await c.query(`INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at) VALUES ($1,$2,$3,$4,'CASH','2026-11-02','RC-${uuid().slice(0,6)}',now())`, [id, org, res, amount]);
  return id;
}
async function seedDeposit(c, org, res, amount) {
  const id = uuid();
  await c.query(`INSERT INTO deposit_transactions (id, organization_id, resident_id, type, status, amount, received_at, updated_at) VALUES ($1,$2,$3,'RECEIVED','POSTED',$4,'2026-11-02',now())`, [id, org, res, amount]);
  return id;
}

(async () => {
  assertLocalTestHost();
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  const migrations = readMigrations();
  check('[m3c migration present]', migrations.some((m) => m.name.includes('m3c_deposit_refund_expense_reversal')));

  const fresh = await newDb(admin, 'fresh');
  let applyErr = null;
  try { await applyMigrations(fresh.c, migrations); } catch (e) { applyErr = e; }
  check('[fresh: all migrations apply]', !applyErr, applyErr ? applyErr.message : '');

  const { org, user, res } = await seedOrgRes(fresh.c);
  const res2 = uuid();
  await fresh.c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R2',now())`, [res2, org]);
  const org2 = uuid();
  await fresh.c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org2',now())`, [org2]);
  const resOrg2 = uuid();
  await fresh.c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RO2',now())`, [resOrg2, org2]);

  const enumPayment = await fresh.c.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='PaymentMethod'`);
  check('[enum DEPOSIT_APPLICATION]', enumPayment.rows.some((r) => r.enumlabel === 'DEPOSIT_APPLICATION'));
  const enumRev = await fresh.c.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='ReversalSourceType' ORDER BY enumsortorder`);
  check('[enum ReversalSourceType]', JSON.stringify(enumRev.rows.map((r) => r.enumlabel)) === JSON.stringify(['CHARGE', 'PAYMENT', 'DEPOSIT', 'EXPENSE']));

  check('[col deposit.actor_user_id]', !!(await fresh.c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='deposit_transactions' AND column_name='actor_user_id'`)).rows[0]);
  check('[col expense.actor_user_id]', !!(await fresh.c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='actor_user_id'`)).rows[0]);
  const receiptNull = await fresh.c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='payments' AND column_name='receipt_number'`);
  check('[col receipt_number nullable]', receiptNull.rows[0].is_nullable === 'YES');

  for (const t of ['ledger_reversals', 'payment_refunds', 'deposit_applications']) {
    const r = await fresh.c.query(`SELECT to_regclass('public."${t}"') AS t`);
    check(`[table ${t}]`, r.rows[0].t === t);
  }

  const checks = await fresh.c.query(`SELECT conname FROM pg_constraint WHERE contype='c' AND conname LIKE '%_amount_positive' ORDER BY conname`);
  const checkNames = checks.rows.map((r) => r.conname);
  for (const n of ['ledger_reversals_amount_positive', 'payment_refunds_amount_positive', 'deposit_applications_amount_positive']) check(`[check ${n}]`, checkNames.includes(n));

  const triggers = await fresh.c.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%_prevent_delete' ORDER BY tgname`);
  const triggerNames = triggers.rows.map((r) => r.tgname);
  for (const t of ['deposit_transactions_prevent_delete', 'expenses_prevent_delete', 'ledger_reversals_prevent_delete', 'payment_refunds_prevent_delete', 'deposit_applications_prevent_delete']) check(`[trigger ${t}]`, triggerNames.includes(t));

  const fks = await fresh.c.query(`SELECT conname FROM pg_constraint WHERE contype='f' AND array_length(conkey, 1) >= 2 ORDER BY conname`);
  const fkNames = new Set(fks.rows.map((r) => r.conname));
  const m3cCompositeFks = [
    'ledger_reversals_organization_id_resident_id_fkey',
    'payment_refunds_organization_id_resident_id_fkey',
    'payment_refunds_organization_id_resident_id_payment_id_fkey',
    'deposit_applications_organization_id_resident_id_fkey',
    'deposit_applications_organization_id_resident_id_deposit_t_fkey',
    'deposit_applications_organization_id_resident_id_charge_id_fkey',
  ];
  check('[fk: all 6 M3c composite FKs]', m3cCompositeFks.every((n) => fkNames.has(n)), `total=${fks.rowCount}`);
  check('[fk: composite FK count = 30]', fks.rowCount === 30, `count=${fks.rowCount}`);

  const depRecv = await seedDeposit(fresh.c, org, res, 10000);
  const charge = await seedCharge(fresh.c, org, res, 10000);
  const charge2 = await seedCharge(fresh.c, org, res2, 10000);
  const pay = await seedPayment(fresh.c, org, res, 10000);

  check('[check: refund amount=0]', (await errCode(fresh.c, `INSERT INTO payment_refunds (id,organization_id,resident_id,payment_id,amount,reason,actor_user_id) VALUES ($1,$2,$3,$4,0,'x',$5)`, [uuid(), org, res, pay, user])) === '23514');
  check('[check: reversal amount=0]', (await errCode(fresh.c, `INSERT INTO ledger_reversals (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key) VALUES ($1,$2,$3,'CHARGE',$4,'DEBIT',0,'x',$5,$6)`, [uuid(), org, res, charge, user, uuid()])) === '23514');
  check('[check: application amount<0]', (await errCode(fresh.c, `INSERT INTO deposit_applications (id,organization_id,resident_id,deposit_transaction_id,charge_id,amount,reason,actor_user_id) VALUES ($1,$2,$3,$4,$5,-5,'x',$6)`, [uuid(), org, res, depRecv, charge, user])) === '23514');

  check('[fk: cross-resident refund]', (await errCode(fresh.c, `INSERT INTO payment_refunds (id,organization_id,resident_id,payment_id,amount,reason,actor_user_id) VALUES ($1,$2,$3,$4,100,'x',$5)`, [uuid(), org, res2, pay, user])) !== null);
  check('[fk: cross-org application]', (await errCode(fresh.c, `INSERT INTO deposit_applications (id,organization_id,resident_id,deposit_transaction_id,charge_id,amount,reason,actor_user_id) VALUES ($1,$2,$3,$4,$5,100,'x',$6)`, [uuid(), org2, resOrg2, depRecv, charge2, user])) !== null);

  check('[immutability: deposit delete]', (await errCode(fresh.c, `DELETE FROM deposit_transactions WHERE id=$1`, [depRecv])) === 'P0001');
  const exp = uuid();
  await fresh.c.query(`INSERT INTO expenses (id, organization_id, category, status, amount, spent_at, updated_at) VALUES ($1,$2,'Util','POSTED',500,'2026-11-03',now())`, [exp, org]);
  check('[immutability: expense delete]', (await errCode(fresh.c, `DELETE FROM expenses WHERE id=$1`, [exp])) === 'P0001');

  const { spawnSync } = require('child_process');
  const out = path.join(require('os').tmpdir(), `m3c_parity_${fresh.name}.sql`);
  const r = spawnSync('npx', ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', out],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl(fresh.name) }, shell: process.platform === 'win32' });
  let diff = '';
  try { diff = fs.readFileSync(out, 'utf8'); } catch {}
  try { fs.unlinkSync(out); } catch {}
  check('[parity: migrate diff exit 0]', r.status === 0, 'status=' + r.status);
  check('[parity: migrate diff empty]', diff.replace(/^\s*-- This is an empty migration\.\s*$/m, '').trim() === '');

  await fresh.c.end();
  await admin.query(`DROP DATABASE IF EXISTS "${fresh.name}" WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});
  console.log('\n' + results.join('\n'));
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M3c migration checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });