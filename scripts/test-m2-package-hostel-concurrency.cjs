'use strict';
/**
 * M-2 package/hostel trigger concurrency tests (issue #2).
 *
 * The contract BEFORE trigger reads the package with SELECT ... FOR UPDATE so a
 * concurrent accommodation_packages.hostel_id update and a stay_contracts
 * insert/update serialize on the same package row. Two real connections, two
 * orders:
 *   A. UPDATE package (hostel A->B)  then  INSERT contract.
 *   B. INSERT contract               then  UPDATE package (hostel A->B).
 * One operation blocks, then rejects with 23514; the invariant survives.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const uuid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dbUrl(name) { const u = new URL(BASE_URL); u.pathname = `/${name}`; return u.toString(); }
function adminUrl() { const u = new URL(BASE_URL); u.pathname = '/postgres'; return u.toString(); }

function assertLocalTestHost() {
  let host = '', db = '';
  try { const u = new URL(BASE_URL); host = u.hostname; db = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch {}
  const okHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  const okDb = ['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db);
  if ((!okHost || !okDb) && process.env.ESKAN_TEST_DB_ALLOW !== '1') {
    console.error(`REFUSED: this script creates/drops throwaway databases. host="${host}" db="${db}" is not local.`);
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

async function seed(c) {
  const o = uuid(), h1 = uuid(), h2 = uuid(), pkg = uuid(), res = uuid();
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'O',now())`, [o]);
  await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H1',now()),($3,$2,'H2',now())`, [h1, o, h2]);
  await c.query(`INSERT INTO accommodation_packages (id, organization_id, hostel_id, name, created_at, updated_at) VALUES ($1,$2,$3,'P',now(),now())`, [pkg, o, h1]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [res, o]);
  return { o, h1, h2, pkg, res };
}

// A. UPDATE package (hostel A->B) committed while a contract INSERT waits on the
//    package FOR UPDATE. The INSERT must then observe hostel B and reject.
async function scenarioUpdateThenInsert(dbA, dbB) {
  const d = await seed(dbA);
  await dbA.query('BEGIN');
  await dbA.query(`UPDATE accommodation_packages SET hostel_id=$2, updated_at=now() WHERE id=$1`, [d.pkg, d.h2]);

  let bResult = null;
  const bPromise = (async () => {
    await dbB.query('BEGIN');
    try {
      await dbB.query(`SET LOCAL lock_timeout = '8000ms'`);
      await dbB.query(
        `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, package_id, status, start_date, rent_amount, updated_at)
         VALUES ($1,$2,$3,$4,'C-A',$5,'ACTIVE','2020-01-01',100,now())`,
        [uuid(), d.o, d.h1, d.res, d.pkg],
      );
      await dbB.query('COMMIT');
      bResult = 'inserted';
    } catch (e) {
      await dbB.query('ROLLBACK').catch(() => {});
      bResult = e.code;
    }
  })();

  await sleep(700);
  await dbA.query('COMMIT');
  await bPromise;

  check('[conc A] insert blocked then rejected after package move (23514)', bResult === '23514', 'result=' + bResult);
  const bad = await dbA.query(`SELECT count(*)::int n FROM stay_contracts sc JOIN accommodation_packages p ON p.id=sc.package_id WHERE p.hostel_id IS NOT NULL AND sc.hostel_id <> p.hostel_id`);
  check('[conc A] invariant preserved (0 mismatches)', bad.rows[0].n === 0, 'mismatches=' + bad.rows[0].n);
}
// B. INSERT contract (FOR UPDATE on package) committed while a package-host
//    UPDATE waits. After the insert commits, the package-host UPDATE must be
//    rejected by the guard trigger.
async function scenarioInsertThenUpdate(dbA, dbB) {
  const d = await seed(dbA);
  await dbA.query('BEGIN');
  await dbA.query(
    `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, package_id, status, start_date, rent_amount, updated_at)
     VALUES ($1,$2,$3,$4,'C-B',$5,'ACTIVE','2020-01-01',100,now())`,
    [uuid(), d.o, d.h1, d.res, d.pkg],
  );

  let bResult = null;
  const bPromise = (async () => {
    await dbB.query('BEGIN');
    try {
      await dbB.query(`SET LOCAL lock_timeout = '8000ms'`);
      await dbB.query(`UPDATE accommodation_packages SET hostel_id=$2, updated_at=now() WHERE id=$1`, [d.pkg, d.h2]);
      await dbB.query('COMMIT');
      bResult = 'updated';
    } catch (e) {
      await dbB.query('ROLLBACK').catch(() => {});
      bResult = e.code;
    }
  })();

  await sleep(700);
  await dbA.query('COMMIT');
  await bPromise;

  check('[conc B] package update rejected by guard after contract insert (23514)', bResult === '23514', 'result=' + bResult);
  const bad = await dbA.query(`SELECT count(*)::int n FROM stay_contracts sc JOIN accommodation_packages p ON p.id=sc.package_id WHERE p.hostel_id IS NOT NULL AND sc.hostel_id <> p.hostel_id`);
  check('[conc B] invariant preserved (0 mismatches)', bad.rows[0].n === 0, 'mismatches=' + bad.rows[0].n);
}

(async () => {
  assertLocalTestHost();
  const name = `eskan_m2_conc_${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const setup = new Client({ connectionString: dbUrl(name) });
  await setup.connect();
  try {
    for (const m of readMigrations()) await setup.query(m.sql);
  } finally {
    await setup.end();
  }

  const dbA = new Client({ connectionString: dbUrl(name) });
  const dbB = new Client({ connectionString: dbUrl(name) });
  await dbA.connect();
  await dbB.connect();
  try {
    await scenarioUpdateThenInsert(dbA, dbB);
    await scenarioInsertThenUpdate(dbA, dbB);
  } finally {
    await dbA.end().catch(() => {});
    await dbB.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }

  console.log('\n' + results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M-2 package/hostel concurrency checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });