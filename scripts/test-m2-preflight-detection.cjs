'use strict';
// CI detection-regression test for the M-2 read-only preflight.
//
// Seeds a known cross-tenant/cross-resident anomaly — a TemporaryAbsence whose
// creditCharge belongs to a DIFFERENT organization AND a different resident —
// into a throwaway DB, then runs `preflight-m2.cjs --strict` and asserts it
// detects it (exit 1 + the two creditCharge lines fire). Exits 0 on success.
//
// Like the migration harness, this only ever touches a throwaway (eskan_m2_detect_*)
// database created/dropped on a local dev/test server (fail-closed guard).
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const uuid = () => crypto.randomUUID();
const MIGDIR = path.join(__dirname, '..', 'prisma', 'migrations');
const PREFLIGHT = path.join(__dirname, 'preflight-m2.cjs');

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';

function assertLocalTestHost() {
  let host = '', db = '';
  try { const u = new URL(BASE_URL); host = u.hostname; db = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch {}
  const okHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  const okDb = ['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db);
  if ((!okHost || !okDb) && process.env.ESKAN_TEST_DB_ALLOW !== '1') {
    console.error(`REFUSED: destructive harness; host="${host}" db="${db}" is not a local dev/test database. Set ESKAN_TEST_DB_ALLOW=1 to override.`);
    process.exit(2);
  }
}

function check(label, cond, detail) {
  if (cond) { console.log(`PASS - ${label}`); return; }
  console.error(`FAIL - ${label}${detail ? ' - ' + detail : ''}`);
  process.exit(1);
}

(async () => {
  assertLocalTestHost();
  const admin = new Client({ connectionString: (() => { const u = new URL(BASE_URL); u.pathname = '/postgres'; return u.toString(); })() });
  await admin.connect();
  const db = 'eskan_m2_detect_' + Date.now().toString(36);
  await admin.query(`CREATE DATABASE "${db}"`);
  const dbUrl = (() => { const u = new URL(BASE_URL); u.pathname = '/' + db; return u.toString(); })();
  const c = new Client({ connectionString: dbUrl });
  await c.connect();

  const dirs = fs.readdirSync(MIGDIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const n of dirs) await c.query(fs.readFileSync(path.join(MIGDIR, n, 'migration.sql'), 'utf8'));

  const orgA = uuid(), orgB = uuid();
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'OrgA',now()),($2,'OrgB',now())`, [orgA, orgB]);
  const hostA = uuid();
  await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'HA',now())`, [hostA, orgA]);
  const resA = uuid(), resB = uuid();
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RA',now())`, [resA, orgA]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RB',now())`, [resB, orgB]);
  const contractA = uuid();
  await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNTA','ACTIVE','2020-01-01',5000,now())`, [contractA, orgA, hostA, resA]);
  const chargeB = uuid();
  await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',500,'2020-01-01','2020-01-31','2020-01-01',now())`, [chargeB, orgB, resB]);
  const user = uuid();
  await c.query(`INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at) VALUES ($1,'detect@example.com','x','Test User',now(),now())`, [user]);
  // ANOMALY: absence is orgA/resA/contractA, but creditCharge is chargeB (orgB, resB).
  await c.query(`INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, credit_charge_id, status, planned_departure_date, expected_return_date, requested_by_user_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'REQUESTED','2020-02-01','2020-02-15',$6,now(),now())`, [uuid(), orgA, resA, contractA, chargeB, user]);
  await c.end();

  const r = spawnSync(process.execPath, [PREFLIGHT, '--strict'], { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: 'utf8' });
  const stdout = r.stdout || '';
  check('strict mode exits 1 on anomalies', r.status === 1, `status=${r.status}`);
  check('cross-org creditCharge detected', /Absence -> Credit Charge\s+\(org must match\)\s+count=[1-9]/.test(stdout));
  check('cross-resident creditCharge detected', /creditCharge resident\s+count=[1-9]/.test(stdout));

  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
  console.log('M-2 preflight detection test passed');
})().catch((e) => { console.error('FATAL', e); process.exit(2); });