'use strict';
/**
 * M3b migration test (real PostgreSQL, throwaway databases).
 * Proves, with the real migrations applied in real order:
 *   (1) fresh DB — schema shape, domain CHECKs, tenant composite FKs,
 *       financial-document immutability (RESTRICT FK + BEFORE DELETE triggers),
 *       receipt-counter upsert, and exact `prisma migrate diff` parity;
 *   (2) receipt-counter backfill over historical payments:
 *       A/B — numeric backfill + gap policy (next number continues past the max);
 *       C   — non-numeric legacy receipts preserved (lazy init, never guessed);
 *       D   — overflow fail-closed (no truncation/rewrite of historical receipts);
 *   (3) real migrations only — no hand-made table or mocked stand-in.
 * Safety: throwaway databases; never touches eskan_dev / staging / prod.
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
async function newDb(admin, tag) {
  const name = `eskan_m3b_${tag}_${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const c = new Client({ connectionString: dbUrl(name) });
  await c.connect();
  return { name, c };
}
async function dropDb(admin, name) {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
}
async function applyMigrations(c, list) {
  for (const m of list) await c.query(m.sql);
}
async function applyMigrationAtomically(c, sql) {
  try { await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); return null; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); return e; }
}
async function insertOrgRes(c, org, res) {
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [res, org]);
}
async function insertPaymentRaw(c, org, res, receiptNumber) {
  const id = uuid();
  await c.query(`INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at) VALUES ($1,$2,$3,100,'CASH','2026-01-01',$4,now())`, [id, org, res, receiptNumber]);
  return id;
}
async function nextCounter(c, org) {
  const r = await c.query(
    `INSERT INTO receipt_counters (organization_id, counter, updated_at) VALUES ($1, 1, now()) ON CONFLICT (organization_id) DO UPDATE SET counter = receipt_counters.counter + 1, updated_at = now() RETURNING counter::int`,
    [org],
  );
  return r.rows[0].counter;
}

(async () => {
  assertLocalTestHost();
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  const migrations = readMigrations();
  const m3bIdx = migrations.findIndex((m) => m.name.includes('m3b_payment_allocation_receipt'));

  // ---------------------------------------------------------------------------
  // Scenario 0 — fresh DB: all migrations + schema/immutability/counter/parity.
  // ---------------------------------------------------------------------------
  const fresh = await newDb(admin, 'fresh');
  {
    const c = fresh.c;
    await applyMigrations(c, migrations);
    check('all migrations applied (incl. M3b + immutability)', true, `${migrations.length} migrations`);

    const tbl = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('receipt_counters','allocation_releases') ORDER BY table_name`);
    check('[tables] receipt_counters + allocation_releases present', tbl.rowCount === 2, tbl.rows.map((r) => r.table_name).join(','));
    const prov = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='payments' AND column_name='provisional_receipt_id'`);
    check('[column] payments.provisional_receipt_id present', prov.rowCount === 1);
    const uniq = await c.query(`SELECT indexname FROM pg_indexes WHERE indexname='payment_allocations_organization_id_resident_id_id_key'`);
    check('[unique] payment_allocations (organization_id, resident_id, id)', uniq.rowCount === 1);
    const chk = await c.query(`SELECT conname FROM pg_constraint WHERE contype='c' AND conname IN ('allocation_releases_amount_positive','receipt_counters_counter_non_negative') ORDER BY conname`);
    check('[check] M3b CHECK constraints present', chk.rowCount === 2, chk.rows.map((r) => r.conname).join(','));
    // Scope this assertion to M3b-owned tables. Later migrations add valid
    // tenant composite FKs, so a global database count is not a stable M3b test.
    const m3bCompositeFkNames = [
      'allocation_releases_organization_id_resident_id_fkey',
      'allocation_releases_organization_id_resident_id_allocation_fkey',
    ];
    const fks = await c.query(
      `SELECT conname
         FROM pg_constraint
        WHERE contype = 'f'
          AND array_length(conkey, 1) >= 2
          AND conname = ANY($1::text[])
        ORDER BY conname`,
      [m3bCompositeFkNames],
    );
    const actualM3bFkNames = fks.rows.map((row) => row.conname);
    const expectedM3bFkNames = [...m3bCompositeFkNames].sort();
    check(
      '[composite-fk] M3b tenant composite FKs present',
      actualM3bFkNames.length === expectedM3bFkNames.length &&
        actualM3bFkNames.every((name, index) => name === expectedM3bFkNames[index]),
      `expected=${expectedM3bFkNames.length} actual=${actualM3bFkNames.length} names=${actualM3bFkNames.join(',')}`,
    );

    const del = await c.query(`SELECT confdeltype FROM pg_constraint WHERE conname='payment_allocations_organization_id_resident_id_payment_id_fkey'`);
    check('[immutability] payment_allocations -> payments is RESTRICT', del.rowCount === 1 && del.rows[0].confdeltype === 'r', 'confdeltype=' + (del.rows[0] && del.rows[0].confdeltype));
    const trig = await c.query(`SELECT tgname FROM pg_trigger WHERE tgname IN ('payments_prevent_delete','payment_allocations_prevent_delete','allocation_releases_prevent_delete') ORDER BY tgname`);
    check('[immutability] DELETE triggers on payments/payment_allocations/allocation_releases', trig.rowCount === 3, trig.rows.map((r) => r.tgname).join(','));

    const org = uuid(), user = uuid(), res = uuid();
    await insertOrgRes(c, org, res);
    await c.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`, [user, `u-${uuid().slice(0, 8)}@e.com`]);
    const pay = await insertPaymentRaw(c, org, res, '0000000001');
    const chg = uuid();
    await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER',1000,'2026-11-01','2026-12-01','2026-11-05',now())`, [chg, org, res]);
    const alloc = uuid();
    await c.query(`INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount) VALUES ($1,$2,$3,$4,$5,500)`, [alloc, org, res, pay, chg]);
    const rel = uuid();
    await c.query(`INSERT INTO allocation_releases (id, organization_id, resident_id, allocation_id, amount, reason, actor_user_id) VALUES ($1,$2,$3,$4,200,'x',$5)`, [rel, org, res, alloc, user]);
    check('[immutability] DELETE payments rejected (P0001)', (await errCode(c, `DELETE FROM payments WHERE id=$1`, [pay])) === 'P0001');
    check('[immutability] DELETE payment_allocations rejected (P0001)', (await errCode(c, `DELETE FROM payment_allocations WHERE id=$1`, [alloc])) === 'P0001');
    check('[immutability] DELETE allocation_releases rejected (P0001)', (await errCode(c, `DELETE FROM allocation_releases WHERE id=$1`, [rel])) === 'P0001');
    check('[immutability] payment preserved after blocked delete', (await c.query(`SELECT 1 FROM payments WHERE id=$1`, [pay])).rowCount === 1);
    check('[immutability] allocation preserved after blocked delete', (await c.query(`SELECT 1 FROM payment_allocations WHERE id=$1`, [alloc])).rowCount === 1);

    const n1 = await nextCounter(c, org);
    const n2 = await nextCounter(c, org);
    check('[counter] fresh org counter starts at 1 and increments', n1 === 1 && n2 === 2, `counter=${n1},${n2}`);
  }
  await fresh.c.end();

  {
    const out = path.join(process.env.TEMP || __dirname, `m3b_parity_${fresh.name}.sql`);
    const r = spawnSync('npx', ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', out],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl(fresh.name) }, shell: process.platform === 'win32' });
    let diff = '';
    try { diff = fs.readFileSync(out, 'utf8'); } catch {}
    try { fs.unlinkSync(out); } catch {}
    const empty = diff.replace(/^\s*-- This is an empty migration\.\s*$/m, '').trim() === '';
    check('[parity] migrate diff exited 0', r.status === 0, 'status=' + r.status);
    check('[parity] migrate diff is empty (no drift)', empty, 'diffBytes=' + diff.length);
    check('[parity] no DROP emitted', !/DROP (FOREIGN KEY|INDEX|CONSTRAINT|TABLE)/i.test(diff));
  }
  await dropDb(admin, fresh.name);

  // ---------------------------------------------------------------------------
  // Scenario A/B — numeric historical receipts: counter backfilled from MAX.
  // ---------------------------------------------------------------------------
  {
    const { name, c } = await newDb(admin, 'numeric');
    try {
      await applyMigrations(c, migrations.slice(0, m3bIdx));
      const oA = uuid(), rA = uuid(), oB = uuid(), rB = uuid();
      await insertOrgRes(c, oA, rA);
      await insertOrgRes(c, oB, rB);
      await insertPaymentRaw(c, oA, rA, '0000000001');
      await insertPaymentRaw(c, oA, rA, '0000000002');
      await insertPaymentRaw(c, oA, rA, '0000000005');
      await insertPaymentRaw(c, oB, rB, '0000000003');
      await insertPaymentRaw(c, oB, rB, '0000000008');
      await c.query(migrations[m3bIdx].sql);

      const a = await c.query(`SELECT counter::int c FROM receipt_counters WHERE organization_id=$1`, [oA]);
      const b = await c.query(`SELECT counter::int c FROM receipt_counters WHERE organization_id=$1`, [oB]);
      check('[backfill-A] org A counter = 5 (max numeric receipt)', a.rows[0].c === 5, 'counter=' + a.rows[0].c);
      check('[backfill-A] org B counter = 8 (max numeric receipt)', b.rows[0].c === 8, 'counter=' + b.rows[0].c);
      check('[backfill-A] counters are independent per organization', a.rows[0].c !== b.rows[0].c);

      const nextA = await nextCounter(c, oA);
      const nextB = await nextCounter(c, oB);
      check('[backfill-A] next org A receipt = 6 (continues past max)', nextA === 6, 'next=' + nextA);
      check('[backfill-A] next org B receipt = 9 (continues past max)', nextB === 9, 'next=' + nextB);

      // B — gap policy: 1,2,5 exist; next must be 6, never reuse 2/3/4.
      const oldA = await c.query(`SELECT receipt_number FROM payments WHERE organization_id=$1 ORDER BY receipt_number`, [oA]);
      check('[backfill-B] old receipts unchanged (no rewrite)', oldA.rows.map((x) => x.receipt_number).join(',') === '0000000001,0000000002,0000000005', oldA.rows.map((x) => x.receipt_number).join(','));
      check('[backfill-B] gap not reused (next > max, not a hole)', nextA === 6 && !['0000000003', '0000000004'].includes(String(nextA).padStart(10, '0')));
    } finally {
      await c.end();
      await dropDb(admin, name);
    }
  }

  // ---------------------------------------------------------------------------
  // Scenario C — non-numeric legacy receipts: preserved, lazy init, no collision.
  // ---------------------------------------------------------------------------
  {
    const { name, c } = await newDb(admin, 'legacy');
    try {
      await applyMigrations(c, migrations.slice(0, m3bIdx));
      const oC = uuid(), rC = uuid();
      await insertOrgRes(c, oC, rC);
      await insertPaymentRaw(c, oC, rC, 'RCP-OLD');
      await insertPaymentRaw(c, oC, rC, 'INV-99');
      await c.query(migrations[m3bIdx].sql);

      const cnt = await c.query(`SELECT 1 FROM receipt_counters WHERE organization_id=$1`, [oC]);
      check('[backfill-C] non-numeric receipts not guessed into counter', cnt.rowCount === 0);

      const oldC = await c.query(`SELECT receipt_number FROM payments WHERE organization_id=$1 ORDER BY receipt_number`, [oC]);
      check('[backfill-C] legacy receipts preserved (no rewrite)', oldC.rows.map((x) => x.receipt_number).join(',') === 'INV-99,RCP-OLD', oldC.rows.map((x) => x.receipt_number).join(','));

      const nextC = await nextCounter(c, oC);
      check('[backfill-C] lazy init starts at 1 (no collision with legacy)', nextC === 1 && String(nextC).padStart(10, '0') !== 'RCP-OLD', 'next=' + nextC);
    } finally {
      await c.end();
      await dropDb(admin, name);
    }
  }

  // ---------------------------------------------------------------------------
  // Scenario D — numeric receipt exceeding INT32 counter: fail-closed, no rewrite.
  // ---------------------------------------------------------------------------
  {
    const { name, c } = await newDb(admin, 'overflow');
    try {
      await applyMigrations(c, migrations.slice(0, m3bIdx));
      const oD = uuid(), rD = uuid();
      await insertOrgRes(c, oD, rD);
      await insertPaymentRaw(c, oD, rD, '3000000000'); // > INT32_MAX (2147483647)
      const err = await applyMigrationAtomically(c, migrations[m3bIdx].sql);
      check('[backfill-D] overflow fails closed (22003 integer out of range)', !!err && (err.code === '22003'), 'code=' + (err && err.code) + ' msg=' + (err && err.message));
      const oldD = await c.query(`SELECT receipt_number FROM payments WHERE organization_id=$1`, [oD]);
      check('[backfill-D] overflow receipt untouched (no truncation/rewrite)', oldD.rows[0].receipt_number === '3000000000', oldD.rows[0].receipt_number);
      const tbl = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_name='receipt_counters'`);
      check('[backfill-D] migration fully rolled back (no partial receipt_counters)', tbl.rowCount === 0);
    } finally {
      await c.end();
      await dropDb(admin, name);
    }
  }

  await admin.end().catch(() => {});

  console.log('\n' + results.join('\n'));
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M3b migration checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });