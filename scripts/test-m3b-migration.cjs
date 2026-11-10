'use strict';
/**
 * M3b migration test (real PostgreSQL, throwaway DB). Proves migration
 * 20261110120000_m3b_payment_allocation_receipt is additive, enforces positive
 * release amounts (23514) and tenant/resident-scoped release FKs (23503), and
 * leaves the DB in exact parity with prisma/schema.prisma (migrate diff empty).
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
async function errCode(c, sql, params = []) {
  try { await c.query(sql, params); return null; } catch (e) { return e.code || String(e.message); }
}

(async () => {
  assertLocalTestHost();
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  const migrations = readMigrations();
  const fresh = `eskan_m3b_${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;

  await admin.query(`CREATE DATABASE "${fresh}"`);
  const c = new Client({ connectionString: dbUrl(fresh) });
  await c.connect();
  try {
    for (const m of migrations) await c.query(m.sql);
    check('all migrations applied (incl. M3b)', true, `${migrations.length} migrations`);

    const tbl = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('receipt_counters','allocation_releases')`);
    check('[tables] receipt_counters + allocation_releases present', tbl.rowCount === 2, tbl.rows.map((r) => r.table_name).join(','));
    const prov = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='payments' AND column_name='provisional_receipt_id'`);
    check('[column] payments.provisional_receipt_id present', prov.rowCount === 1);
    const uniq = await c.query(`SELECT indexname FROM pg_indexes WHERE indexname='payment_allocations_organization_id_resident_id_id_key'`);
    check('[unique] payment_allocations (organization_id, resident_id, id)', uniq.rowCount === 1);
    const chk = await c.query(`SELECT conname FROM pg_constraint WHERE contype='c' AND conname IN ('allocation_releases_amount_positive','receipt_counters_counter_non_negative')`);
    check('[check] M3b CHECK constraints present', chk.rowCount === 2, chk.rows.map((r) => r.conname).join(','));
    const fks = await c.query(`SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND array_length(conkey,1) >= 2`);
    check('[composite-fk] tenant composite FKs = 24', fks.rows[0].n === 24, 'count=' + fks.rows[0].n);

    const org = uuid(), user = uuid(), res = uuid();
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
    await c.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`, [user, `u-${uuid().slice(0, 8)}@e.com`]);
    await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [res, org]);
    const pay = uuid(), chg = uuid();
    await c.query(`INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at) VALUES ($1,$2,$3,1000,'CASH','2026-11-01','0000000001',now())`, [pay, org, res]);
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER',1000,'2026-11-01','2026-12-01','2026-11-05',now())`, [chg, org, res]);
    const alloc = uuid();
    await c.query(`INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount) VALUES ($1,$2,$3,$4,$5,500)`, [alloc, org, res, pay, chg]);
    check('[release-amount] amount=0 rejected (23514)', (await errCode(c, `INSERT INTO allocation_releases (id, organization_id, resident_id, allocation_id, amount, reason, actor_user_id) VALUES ($1,$2,$3,$4,0,'x',$5)`, [uuid(), org, res, alloc, user])) === '23514');
    check('[release-amount] amount>0 allowed', (await errCode(c, `INSERT INTO allocation_releases (id, organization_id, resident_id, allocation_id, amount, reason, actor_user_id) VALUES ($1,$2,$3,$4,500,'x',$5)`, [uuid(), org, res, alloc, user])) === null);
    const res2 = uuid();
    await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R2',now())`, [res2, org]);
    const alloc2 = uuid();
    await c.query(`INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount) VALUES ($1,$2,$3,$4,$5,500)`, [alloc2, org, res, pay, chg]);
    check('[release-tenant] cross-resident release rejected (23503)', (await errCode(c, `INSERT INTO allocation_releases (id, organization_id, resident_id, allocation_id, amount, reason, actor_user_id) VALUES ($1,$2,$3,$4,500,'x',$5)`, [uuid(), org, res2, alloc2, user])) === '23503');
    const next = await c.query(`INSERT INTO receipt_counters (organization_id, counter, updated_at) VALUES ($1, 1, now()) ON CONFLICT (organization_id) DO UPDATE SET counter = receipt_counters.counter + 1, updated_at = now() RETURNING counter::int`, [org]);
    check('[counter] fresh org counter starts at 1', next.rows[0].counter === 1, 'counter=' + next.rows[0].counter);
  } finally {
    await c.end().catch(() => {});
  }

  const out = path.join(process.env.TEMP || __dirname, `m3b_parity_${fresh}.sql`);
  const r = spawnSync('npx', ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', out],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl(fresh) }, shell: process.platform === 'win32' });
  let diff = '';
  try { diff = fs.readFileSync(out, 'utf8'); } catch {}
  try { fs.unlinkSync(out); } catch {}
  const empty = diff.replace(/^\s*-- This is an empty migration\.\s*$/m, '').trim() === '';
  check('[parity] migrate diff exited 0', r.status === 0, 'status=' + r.status);
  check('[parity] migrate diff is empty (no drift)', empty, 'diffBytes=' + diff.length);
  check('[parity] no DROP emitted', !/DROP (FOREIGN KEY|INDEX|CONSTRAINT|TABLE)/i.test(diff));

  await admin.query(`DROP DATABASE IF EXISTS "${fresh}" WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});

  console.log('\n' + results.join('\n'));
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M3b migration checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });