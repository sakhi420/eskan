'use strict';
/**
 * M-2 Prisma schema/database parity test (issue #1).
 *
 * Reproducibly proves that `prisma migrate diff` between the M-2-migrated database
 * and `prisma/schema.prisma` is EMPTY — i.e. a future `prisma migrate dev` will NOT
 * drop the M-2 composite FKs / unique keys / child indexes, because the Prisma schema
 * models them all (nullable-parent relations are modeled as an optional relation plus
 * a named tenant relation).
 *
 * Safety: creates a throwaway database and drops it; never touches eskan_dev.
 */
const { Client } = require('pg');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');

function dbUrl(name) { const u = new URL(BASE_URL); u.pathname = `/${name}`; return u.toString(); }
function adminUrl() { const u = new URL(BASE_URL); u.pathname = '/postgres'; return u.toString(); }

function assertLocalTestHost() {
  let host = '', db = '';
  try { const u = new URL(BASE_URL); host = u.hostname; db = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch {}
  const okHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  const okDb = ['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db);
  if ((!okHost || !okDb) && process.env.ESKAN_TEST_DB_ALLOW !== '1') {
    console.error(`REFUSED: host="${host}" db="${db}" is not local.`);
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

(async () => {
  assertLocalTestHost();
  const name = `eskan_m2_parity_${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const c = new Client({ connectionString: dbUrl(name) });
  await c.connect();
  try {
    for (const m of readMigrations()) await c.query(m.sql);
  } finally {
    await c.end();
  }

  const out = path.join(os.tmpdir(), `m2_parity_${name}.sql`);
  const r = spawnSync(
    'npx',
    ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', out],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl(name) }, shell: process.platform === 'win32' },
  );
  let diff = '';
  try { diff = fs.readFileSync(out, 'utf8'); } catch {}
  try { fs.unlinkSync(out); } catch {}

  check('[parity] prisma migrate diff exited 0', r.status === 0, 'status=' + r.status);
  const empty = diff.replace(/^\s*-- This is an empty migration\.\s*$/m, '').trim() === '';
  check('[parity] migrate diff is empty (no drift)', empty, 'diffBytes=' + diff.length);
  check('[parity] no DROP statements would be emitted', !/DROP (FOREIGN KEY|INDEX|CONSTRAINT|TABLE)/i.test(diff));
  check('[parity] no M-2 composite FK would be dropped', !/organization_id.*_fkey".*DROP|\bDROP CONSTRAINT "(rooms|beds|charges|payments|stay_contracts|bed_assignments|temporary_absences|expenses|deposit_transactions|payment_allocations|accommodation_packages)_organization_id/i.test(diff));

  // Also assert the live DB actually contains every M-2 composite FK (scope guard).
  const client = new Client({ connectionString: dbUrl(name) });
  await client.connect();
  const fks = await client.query(`SELECT conname FROM pg_constraint WHERE contype='f' AND array_length(conkey, 1) >= 2 ORDER BY conname`);
  check('[parity] live DB has 22 tenant composite FKs (multi-column)', fks.rowCount === 22, 'count=' + fks.rowCount);
  await client.end();

  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});

  console.log('\n' + results.join('\n'));
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M-2 Prisma parity checks passed`);
  if (failed || diff.trim() !== '' && !/This is an empty migration/.test(diff)) {
    console.log('\n--- migrate diff output (if any) ---\n' + diff);
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });