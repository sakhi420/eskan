'use strict';
/**
 * Tenant-scoped Prisma schema/database parity test (M-2 + subsequent gates).
 *
 * Reproducibly proves that `prisma migrate diff` between the fully migrated database
 * and `prisma/schema.prisma` is EMPTY — i.e. a future `prisma migrate dev` will NOT
 * drop tenant composite FKs / unique keys / child indexes. M3b adds two further
 * composite FKs for AllocationRelease; those are included in the FK-count assertion.
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
  check('[parity] no tenant composite FK would be dropped', !/organization_id.*_fkey".*DROP|\bDROP CONSTRAINT "(rooms|beds|charges|payments|stay_contracts|bed_assignments|temporary_absences|expenses|deposit_transactions|payment_allocations|accommodation_packages|allocation_releases)_organization_id/i.test(diff));

  // Assert the tenant composite-FK inventory across M-2 and M3b.
  // M3b adds two AllocationRelease FKs: (organization_id, resident_id) and
  // (organization_id, resident_id, allocation_id).
  const client = new Client({ connectionString: dbUrl(name) });
  await client.connect();
  const fks = await client.query(`SELECT conname FROM pg_constraint WHERE contype='f' AND array_length(conkey, 1) >= 2 ORDER BY conname`);
  const fkNames = new Set(fks.rows.map((row) => row.conname));
  const m3bReleaseFks = [
    'allocation_releases_organization_id_resident_id_fkey',
    'allocation_releases_organization_id_resident_id_allocation_fkey',
  ];
  check('[parity] live DB has 24 tenant composite FKs (M-2 + M3b)', fks.rowCount === 24, 'count=' + fks.rowCount);
  check('[parity] both M3b AllocationRelease tenant FKs are present', m3bReleaseFks.every((name) => fkNames.has(name));
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