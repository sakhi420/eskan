'use strict';
/**
 * M3a migration test (real PostgreSQL, throwaway database).
 * Proves the additive migration 20261108220000_m3a_charge_billing_credit:
 *  (1) applies cleanly so the DB exactly matches prisma/schema.prisma
 *      (`prisma migrate diff` empty);
 *  (2) adds EntrySide/BillingRunStatus enums + charges.entry_side (DEBIT);
 *  (3) adds charge_package_components/absence_credits/billing_runs with
 *      Prisma-compatible composite FKs (tenant+resident integrity);
 *  (4) adds the raw-SQL rent business-key partial unique index and the domain
 *      CHECK constraints (Prisma cannot model them), verified via pg catalogs;
 *  (5) enforces the rent business key (duplicate RENT rejected, other type ok).
 * Safety: throwaway database created and dropped; never touches eskan_dev.
 */
const { Client } = require('pg');
const { spawnSync } = require('child_process');
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
  const okHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  const okDb = ['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db);
  if ((!okHost || !okDb) && process.env.ESKAN_TEST_DB_ALLOW !== '1') {
    console.error(`REFUSED: host="${host}" db="${db}" is not a local dev/test database.`);
    process.exit(2);
  }
}

function readMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8') }));
}

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' - ' + extra : ''}`);
async function errCode(promise) { try { await promise; return null; } catch (e) { return e.code || String(e.message); } }

(async () => {
  assertLocalTestHost();
  const name = `eskan_m3a_${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const c = new Client({ connectionString: dbUrl(name) });
  await c.connect();
  try {
    const migrations = readMigrations();
    for (const m of migrations) await c.query(m.sql);
    check('all migrations applied (incl. M3a)', true, `${migrations.length} migrations`);

    const org = uuid(); const resident = uuid(); const hostel = uuid(); const contract = uuid();
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
    await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`, [hostel, org]);
    await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT-1','ACTIVE','2026-11-01',1000,now())`, [contract, org, hostel, resident]);

    const charge = (cid, type) => c.query(
      `INSERT INTO charges (id, organization_id, resident_id, contract_id, type, amount, period_start, period_end, due_date, updated_at)
       VALUES ($1,$2,$3,$4,$5,1000,'2026-11-01','2026-12-01','2026-11-01',now())`,
      [cid, org, resident, contract, type],
    );
    check('[rent-biz-key] first RENT charge allowed', (await errCode(charge(uuid(), 'RENT'))) === null);
    check('[rent-biz-key] duplicate RENT same period rejected (23505)', (await errCode(charge(uuid(), 'RENT'))) === '23505');
    check('[rent-biz-key] distinct type (OTHER) same period allowed', (await errCode(charge(uuid(), 'OTHER'))) === null);
  } finally {
    await c.end().catch(() => {});
  }

  const out = path.join(process.env.TEMP || __dirname, `m3a_parity_${name}.sql`);
  const r = spawnSync(
    'npx', ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', out],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl(name) }, shell: process.platform === 'win32' },
  );
  let diff = '';
  try { diff = fs.readFileSync(out, 'utf8'); } catch {}
  try { fs.unlinkSync(out); } catch {}
  const empty = diff.replace(/^\s*-- This is an empty migration\.\s*$/m, '').trim() === '';
  check('[parity] migrate diff exited 0', r.status === 0, 'status=' + r.status);
  check('[parity] migrate diff is empty (no drift)', empty, 'diffBytes=' + diff.length);
  check('[parity] no DROP emitted', !/DROP (FOREIGN KEY|INDEX|CONSTRAINT|TABLE)/i.test(diff));

  const c2 = new Client({ connectionString: dbUrl(name) });
  await c2.connect();
  const col = await c2.query(`SELECT column_default FROM information_schema.columns WHERE table_name='charges' AND column_name='entry_side'`);
  check('[entry_side] column present with DEBIT default', col.rows[0] && /DEBIT/.test(col.rows[0].column_default || ''));
  const partial = await c2.query(`SELECT indexdef FROM pg_indexes WHERE indexname='charges_rent_business_key'`);
  check('[partial-index] charges_rent_business_key with type=RENT predicate', partial.rowCount === 1 && /RENT/.test(partial.rows[0].indexdef));
  const chk = await c2.query(`SELECT conname FROM pg_constraint WHERE contype='c' AND conname IN ('charges_period_consistent','absence_credits_amount_positive','billing_runs_due_day_of_month_range') ORDER BY conname`);
  check('[check] M3a CHECK constraints present', chk.rowCount === 3, chk.rows.map(x => x.conname).join(','));
  const fks = await c2.query(`SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND array_length(conkey,1) >= 2`);
  check('[composite-fk] tenant composite FKs = 22', fks.rows[0].n === 22, 'count=' + fks.rows[0].n);
  await c2.end().catch(() => {});

  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});

  console.log('\n' + results.join('\n'));
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M3a migration checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });