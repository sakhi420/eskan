'use strict';
/**
 * M-2 package/hostel trigger concurrency tests (issue #2) — deterministic.
 *
 * The contract BEFORE trigger reads the package with SELECT ... FOR UPDATE so a
 * concurrent accommodation_packages.hostel_id update and a stay_contracts
 * insert/update serialize on the same package row. Two real connections, two
 * orders:
 *   A. UPDATE package (hostel A->B)  then  INSERT contract.
 *   B. INSERT contract               then  UPDATE package (hostel A->B).
 *
 * No fixed sleep is used. A third *monitor* connection inspects pg_stat_activity
 * and pg_blocking_pids() to PROVE the second connection (identified by
 * application_name) is actually blocked on the first before that first
 * transaction is committed. If the wait is never observed, the test FAILS
 * instead of relying on timing.
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

const INVARIANT_SQL = `SELECT count(*)::int n
  FROM stay_contracts sc
  JOIN accommodation_packages p ON p.id = sc.package_id
 WHERE p.hostel_id IS NOT NULL AND sc.hostel_id <> p.hostel_id`;

async function backendPid(c) {
  return (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
}

// Deterministic barrier: a third connection polls pg_stat_activity until it has
// PROOF that the backend `blockedPid` (identified by `appName`) is waiting on a
// lock held by `blockerPid` (via pg_blocking_pids). No fixed sleep is used.
async function waitForLockWait(monitor, blockedPid, blockerPid, appName, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await monitor.query(
      `SELECT a.pid, a.state, a.wait_event_type, a.wait_event, a.application_name,
              pg_blocking_pids(a.pid) AS blockers
         FROM pg_stat_activity a
        WHERE a.pid = $1`,
      [blockedPid],
    );
    const row = res.rows[0];
    if (row) {
      last = row;
      const blockers = (row.blockers || []).map(Number);
      if (blockers.includes(Number(blockerPid)) && row.application_name === appName) {
        return { observed: true, row, blockers };
      }
    }
    await sleep(25);
  }
  const blockers = last ? (last.blockers || []).map(Number) : [];
  return { observed: false, row: last, blockers };
}

// blocker() opens a transaction on A and takes the package row lock, staying
// uncommitted. blocked() runs on B inside its own transaction. We only commit A
// once B is PROVEN blocked on A; blocked()'s outcome is then observed.
async function runBlockingPair(label, dbA, dbB, monitor, d, blocker, blocked) {
  const aPid = await backendPid(dbA);
  const bPid = await backendPid(dbB);
  const appName = `m2concB_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  await dbB.query(`SET application_name = '${appName}'`);

  await blocker(dbA, d);

  const bPromise = (async () => {
    await dbB.query('BEGIN');
    try {
      await dbB.query(`SET LOCAL lock_timeout = '30000ms'`);
      await blocked(dbB, d);
      await dbB.query('COMMIT');
      return 'committed';
    } catch (e) {
      await dbB.query('ROLLBACK').catch(() => {});
      return e.code;
    }
  })();

  const w = await waitForLockWait(monitor, bPid, aPid, appName, 10000);
  check(
    `[${label}] dbB blocked on dbA lock (pg_blocking_pids)`,
    w.observed,
    w.observed
      ? `blockers=[${w.blockers.join(',')}] wait=${w.row.wait_event_type}/${w.row.wait_event}`
      : (w.row
          ? `NOT observed: state=${w.row.state} wait=${w.row.wait_event_type}/${w.row.wait_event} blockers=[${w.blockers.join(',')}]`
          : 'NOT observed: no pg_stat_activity row'),
  );

  await dbA.query('COMMIT');
  return await bPromise;
}

async function seed(c) {
  const o = uuid(), h1 = uuid(), h2 = uuid(), pkg = uuid(), res = uuid();
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'O',now())`, [o]);
  await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H1',now()),($3,$2,'H2',now())`, [h1, o, h2]);
  await c.query(`INSERT INTO accommodation_packages (id, organization_id, hostel_id, name, created_at, updated_at) VALUES ($1,$2,$3,'P',now(),now())`, [pkg, o, h1]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [res, o]);
  return { o, h1, h2, pkg, res };
}

// A. UPDATE package (hostel A->B) committed while a contract INSERT is *proven*
//    to be blocked on the package FOR UPDATE. After the package move commits, the
//    INSERT observes hostel B and rejects (23514).
async function scenarioUpdateThenInsert(dbA, dbB, monitor) {
  const d = await seed(dbA);
  const bOutcome = await runBlockingPair(
    'conc A',
    dbA, dbB, monitor, d,
    async (a, s) => {
      await a.query('BEGIN');
      await a.query(`UPDATE accommodation_packages SET hostel_id=$2, updated_at=now() WHERE id=$1`, [s.pkg, s.h2]);
    },
    async (b, s) => {
      await b.query(
        `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, package_id, status, start_date, rent_amount, updated_at)
         VALUES ($1,$2,$3,$4,'C-A',$5,'ACTIVE','2020-01-01',100,now())`,
        [uuid(), s.o, s.h1, s.res, s.pkg],
      );
    },
  );
  check('[conc A] insert blocked then rejected after package move (23514)', bOutcome === '23514', 'result=' + bOutcome);
  const bad = await dbA.query(INVARIANT_SQL);
  check('[conc A] invariant preserved (0 mismatches)', bad.rows[0].n === 0, 'mismatches=' + bad.rows[0].n);
}
// B. INSERT contract (FOR UPDATE on package) committed while a package-host
//    UPDATE is *proven* blocked on the same package row. After the insert
//    commits, the package-host UPDATE is rejected by the guard trigger (23514).
async function scenarioInsertThenUpdate(dbA, dbB, monitor) {
  const d = await seed(dbA);
  const bOutcome = await runBlockingPair(
    'conc B',
    dbA, dbB, monitor, d,
    async (a, s) => {
      await a.query('BEGIN');
      await a.query(
        `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, package_id, status, start_date, rent_amount, updated_at)
         VALUES ($1,$2,$3,$4,'C-B',$5,'ACTIVE','2020-01-01',100,now())`,
        [uuid(), s.o, s.h1, s.res, s.pkg],
      );
    },
    async (b, s) => {
      await b.query(`UPDATE accommodation_packages SET hostel_id=$2, updated_at=now() WHERE id=$1`, [s.pkg, s.h2]);
    },
  );
  check('[conc B] package update rejected by guard after contract insert (23514)', bOutcome === '23514', 'result=' + bOutcome);
  const bad = await dbA.query(INVARIANT_SQL);
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
  const monitor = new Client({ connectionString: dbUrl(name) });
  await dbA.connect();
  await dbB.connect();
  await monitor.connect();
  try {
    await scenarioUpdateThenInsert(dbA, dbB, monitor);
    await scenarioInsertThenUpdate(dbA, dbB, monitor);
  } finally {
    await dbA.end().catch(() => {});
    await dbB.end().catch(() => {});
    await monitor.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }

  console.log('\n' + results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M-2 package/hostel concurrency checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });