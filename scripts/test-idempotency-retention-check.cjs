'use strict';
/**
 * Idempotency retention-consistency CHECK tests (real PostgreSQL).
 *
 * Proves the additive migration 20261108190000_idempotency_retention_consistency_check:
 *   (1) adds a real CHECK constraint to idempotency_records — verified directly
 *       via pg_constraint (contype='c'), NOT via `prisma migrate diff`, which
 *       cannot express raw SQL CHECK constraints and therefore cannot prove it;
 *   (2) rejects every invalid retention/expiry state with SQLSTATE 23514 for
 *       BOTH INSERT and UPDATE, while leaving pre-existing rows untouched.
 *
 * Safety: creates a throwaway database and drops it; never touches eskan_dev.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const CHECK_MIGRATION = '20261108190000_idempotency_retention_consistency_check';
const CONSTRAINT = 'idempotency_records_retention_consistency_check';

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

async function errCode(promise) {
  try { await promise; return null; } catch (e) { return e.code || String((e && e.message) || e); }
}

(async () => {
  assertLocalTestHost();
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  const name = `eskan_retchk_${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const c = new Client({ connectionString: dbUrl(name) });
  await c.connect();
  try {
    const migrations = readMigrations();
    for (const m of migrations.filter((x) => x.name < CHECK_MIGRATION)) await c.query(m.sql);

    // A valid pre-existing (legacy) TRANSIENT record, seeded BEFORE the new CHECK.
    const org = uuid();
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
    await c.query(
      `INSERT INTO idempotency_records (id, organization_id, idempotency_key, user_id, endpoint, request_hash, retention_class, expires_at)
       VALUES ($1,$2,'legacy-key',$3,'/api/v1/legacy','legacy-hash','TRANSIENT',now())`,
      [uuid(), org, uuid()],
    );

    const m = migrations.find((x) => x.name === CHECK_MIGRATION);
    check('CHECK migration directory present', !!m, CHECK_MIGRATION);
    if (m) await c.query(m.sql);

    // (1) Constraint exists via pg_constraint (contype='c' = CHECK).
    const con = await c.query(`SELECT conname FROM pg_constraint WHERE conname=$1 AND contype='c'`, [CONSTRAINT]);
    check('[pg_constraint] CHECK constraint present', con.rowCount === 1, 'contype=c');

    // (2) Pre-existing row untouched (no backfill).
    const legacy = await c.query(`SELECT retention_class::text rc, expires_at FROM idempotency_records WHERE idempotency_key='legacy-key'`);
    check('[no-backfill] legacy TRANSIENT row keeps non-null expires_at', legacy.rows[0].rc === 'TRANSIENT' && legacy.rows[0].expires_at !== null);

    // (3) INSERT — all four states.
    const ins = (key, retention, expires) => c.query(
      `INSERT INTO idempotency_records (id, organization_id, idempotency_key, user_id, endpoint, request_hash, retention_class, expires_at)
       VALUES ($1,$2,$3,$4,'/api/v1/retention-test','test-hash',$5,$6)`,
      [uuid(), org, key, uuid(), retention, expires],
    );
    check('[insert] TRANSIENT + expires_at allowed', (await errCode(ins('i-good-transient', 'TRANSIENT', new Date()))) === null);
    check('[insert] PERMANENT + NULL allowed', (await errCode(ins('i-good-permanent', 'PERMANENT', null))) === null);
    check('[insert] PERMANENT + non-null rejected (23514)', (await errCode(ins('i-bad-permanent', 'PERMANENT', new Date()))) === '23514');
    check('[insert] TRANSIENT + NULL rejected (23514)', (await errCode(ins('i-bad-transient', 'TRANSIENT', null))) === '23514');

    // (4) UPDATE — valid and invalid transitions.
    await c.query(
      `INSERT INTO idempotency_records (id, organization_id, idempotency_key, user_id, endpoint, request_hash, retention_class, expires_at)
       VALUES ($1,$2,'u-transient',$3,'/api/v1/retention-upd','u-hash','TRANSIENT',now())`,
      [uuid(), org, uuid()],
    );
    check('[update] TRANSIENT -> TRANSIENT (refresh expires) allowed', (await errCode(c.query(`UPDATE idempotency_records SET expires_at = now() + interval '1 day' WHERE idempotency_key='u-transient'`))) === null);
    check('[update] TRANSIENT -> expires_at NULL rejected (23514)', (await errCode(c.query(`UPDATE idempotency_records SET expires_at=NULL WHERE idempotency_key='u-transient'`))) === '23514');
    check('[update] TRANSIENT -> PERMANENT (non-null expires) rejected (23514)', (await errCode(c.query(`UPDATE idempotency_records SET retention_class='PERMANENT' WHERE idempotency_key='u-transient'`))) === '23514');
    check('[update] TRANSIENT+expires -> PERMANENT+NULL allowed', (await errCode(c.query(`UPDATE idempotency_records SET retention_class='PERMANENT', expires_at=NULL WHERE idempotency_key='u-transient'`))) === null);
  } finally {
    await c.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }

  console.log('\n' + results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} idempotency retention-consistency CHECK checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });