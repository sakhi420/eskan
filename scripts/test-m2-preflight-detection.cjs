'use strict';
// CI detection-regression test for the M-2 read-only preflight.
//
// Seeds independent anomalies (TemporaryAbsence->creditCharge AND
// AccommodationPackage relations) into a throwaway DB and asserts the preflight
// detects each one separately (org vs resident vs hostel), then runs
// `preflight-m2.cjs --strict` and asserts exit 1 + each affected check line
// counts exactly 1. Exits 0 on success.
//
// Cleanup (DROP DATABASE + close connections) is in a finally block so it runs
// even when an assertion or SQL error fails the test.
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const uuid = () => crypto.randomUUID();
const MIGDIR = path.join(__dirname, '..', 'prisma', 'migrations');
const PREFLIGHT = path.join(__dirname, 'preflight-m2.cjs');

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';

function adminUrl() {
  const u = new URL(BASE_URL);
  u.pathname = '/postgres';
  return u.toString();
}

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
  if (!cond) throw new Error(`${label}${detail ? ' - ' + detail : ''}`);
  console.log(`PASS - ${label}`);
}

(async () => {
  const admin = new Client({ connectionString: adminUrl() });
  let created = null;
  try {
    assertLocalTestHost();
    await admin.connect();
    const db = 'eskan_m2_detect_' + Date.now().toString(36);
    await admin.query(`CREATE DATABASE "${db}"`);
    created = db;
    const dbUrl = (() => { const u = new URL(BASE_URL); u.pathname = '/' + db; return u.toString(); })();
    const c = new Client({ connectionString: dbUrl });
    try {
      await c.connect();
      const dirs = fs.readdirSync(MIGDIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
      for (const n of dirs) await c.query(fs.readFileSync(path.join(MIGDIR, n, 'migration.sql'), 'utf8'));

      const orgA = uuid(), orgB = uuid();
      await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'OrgA',now()),($2,'OrgB',now())`, [orgA, orgB]);
      const hostA = uuid();
      await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'HA',now())`, [hostA, orgA]);
      const resA = uuid(), resA2 = uuid();
      await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RA',now())`, [resA, orgA]);
      await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RA2',now())`, [resA2, orgA]);
      const contractA = uuid(), contractA2 = uuid();
      await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNTA','ACTIVE','2020-01-01',5000,now())`, [contractA, orgA, hostA, resA]);
      await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNTA2','ACTIVE','2020-01-01',5000,now())`, [contractA2, orgA, hostA, resA2]);

// record A target: charge in orgB but resident resA -> only ORG differs from absence A
      const chargeB = uuid();
      await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',500,'2020-01-01','2020-01-31','2020-01-01',now())`, [chargeB, orgB, resA]);
      // record B target: charge in orgA + resident resA -> only RESIDENT differs from absence B
      const chargeA = uuid();
      await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'RENT',600,'2020-01-01','2020-01-31','2020-01-01',now())`, [chargeA, orgA, resA]);
      const user = uuid();
      await c.query(`INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at) VALUES ($1,'detect@example.com','x','Test User',now(),now())`, [user]);

      // --- AccommodationPackage integrity anomalies ---
      const hostA2 = uuid();
      await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'HA2',now())`, [hostA2, orgA]);
      const pkgOrgMis = uuid();
      await c.query(`INSERT INTO accommodation_packages (id, organization_id, hostel_id, name, created_at, updated_at) VALUES ($1,$2,$3,'PKG-X',now(),now())`, [pkgOrgMis, orgB, hostA]);
      const pkgOrgB = uuid();
      await c.query(`INSERT INTO accommodation_packages (id, organization_id, name, created_at, updated_at) VALUES ($1,$2,'PKG-B',now(),now())`, [pkgOrgB, orgB]);
      const pkgHostelA2 = uuid();
      await c.query(`INSERT INTO accommodation_packages (id, organization_id, hostel_id, name, created_at, updated_at) VALUES ($1,$2,$3,'PKG-H',now(),now())`, [pkgHostelA2, orgA, hostA2]);
      const contractPkg = uuid();
      await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, package_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,$5,'CNTP1','DRAFT','2020-01-01',5000,now())`, [contractPkg, orgA, hostA, resA, pkgOrgB]);
      const contractPkgHostel = uuid();
      await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, package_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,$5,'CNTP2','DRAFT','2020-01-01',5000,now())`, [contractPkgHostel, orgA, hostA, resA2, pkgHostelA2]);

      // record A: absence orgA/resA -> creditCharge orgB/resA (org mismatch only)
      await c.query(`INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, credit_charge_id, status, planned_departure_date, expected_return_date, requested_by_user_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'REQUESTED','2020-02-01','2020-02-15',$6,now(),now())`, [uuid(), orgA, resA, contractA, chargeB, user]);
      // record B: absence orgA/resA2 -> creditCharge orgA/resA (resident mismatch only)
      await c.query(`INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, credit_charge_id, status, planned_departure_date, expected_return_date, requested_by_user_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'REQUESTED','2020-02-01','2020-02-15',$6,now(),now())`, [uuid(), orgA, resA2, contractA2, chargeA, user]);
      await c.end();

      const r = spawnSync(process.execPath, [PREFLIGHT, '--strict'], { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: 'utf8' });
      const stdout = r.stdout || '';
      check('strict mode exits 1 on anomalies', r.status === 1, `status=${r.status}`);
      check('cross-org creditCharge detected (org-only record)', /Absence -> Credit Charge\s+\(org must match\)\s+count=1/.test(stdout));
      check('cross-resident creditCharge detected (resident-only record)', /creditCharge resident\s+count=1/.test(stdout));
      check('package->hostel org mismatch detected', /Package -> Hostel\s+\(org must match\)\s+count=1/.test(stdout));
      check('contract->package org mismatch detected', /Contract -> Package\s+\(org must match\)\s+count=1/.test(stdout));
      check('contract vs package hostel mismatch detected', /Contract hostel vs its package hostel\s+count=1/.test(stdout));
      console.log('M-2 preflight detection test passed');
    } finally {
      await c.end().catch(() => {});
    }
  } catch (e) {
    console.error('FAIL', e && e.message ? e.message : e);
    process.exitCode = 2;
  } finally {
    if (created) {
      try { await admin.query(`DROP DATABASE "${created}" WITH (FORCE)`); } catch (e) { console.error('WARN: drop failed', e.message); }
    }
    await admin.end().catch(() => {});
  }
})();