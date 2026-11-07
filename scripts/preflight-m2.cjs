'use strict';
/**
 * M-2 READ-ONLY preflight — relationship inventory & integrity audit.
 *
 * Audit scope (per owner directive): Organization, Resident, Contract
 * (stay_contracts), Charge, Payment, Allocation (payment_allocations), Deposit
 * (deposit_transactions), Assignment (bed_assignments), Hostel, Room, Bed.
 *
 * Strictly read-only / diagnostic:
 *   - fail-closed guard: only allow-listed test/clone DB names on a local host
 *     (override with PREFLIGHT_ALLOW=1 for an explicitly sanctioned clone);
 *   - the whole audit runs inside `BEGIN TRANSACTION READ ONLY`.
 * SELECT only — never ALTER/CREATE/DROP/UPDATE/backfill.
 */
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL || '';
if (!DB_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}

function dbNameOf(u) {
  return decodeURIComponent(new URL(u).pathname.replace(/^\//, ''));
}
function hostOf(u) {
  return new URL(u).hostname;
}

function assertAllowed(u) {
  const db = dbNameOf(u);
  const host = hostOf(u);
  const okDb = /^eskan_(m2|m1|it|preflight|test)/i.test(db) || db === 'eskan_test';
  const okHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  if (!okDb && process.env.PREFLIGHT_ALLOW !== '1') {
    console.error(
      `REFUSED: database "${db}" is not an allow-listed test/clone DB. Run against a clone/test database ` +
        `(e.g. eskan_test or an eskan_m2_* throwaway). Set PREFLIGHT_ALLOW=1 only for an explicitly sanctioned clone.`,
    );
    process.exit(2);
  }
  if (!okHost && process.env.PREFLIGHT_ALLOW !== '1') {
    console.error(
      `REFUSED: host "${host}" is not local. Set PREFLIGHT_ALLOW=1 only for an explicitly sanctioned test clone.`,
    );
    process.exit(2);
  }
}

const CROSS_ORG_CHECKS = [
  { id: 'room.hostel', label: 'Room  -> Hostel              (org must match)', sql: `SELECT r.id, r.organization_id AS child_org, h.organization_id AS parent_org FROM rooms r JOIN hostels h ON h.id = r.hostel_id WHERE r.organization_id <> h.organization_id` },
  { id: 'bed.room', label: 'Bed   -> Room                (org must match)', sql: `SELECT b.id FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.organization_id <> r.organization_id` },
  { id: 'contract.hostel', label: 'Contract -> Hostel        (org must match)', sql: `SELECT sc.id FROM stay_contracts sc JOIN hostels h ON h.id = sc.hostel_id WHERE sc.organization_id <> h.organization_id` },
  { id: 'contract.resident', label: 'Contract -> Resident      (org must match)', sql: `SELECT sc.id FROM stay_contracts sc JOIN residents r ON r.id = sc.resident_id WHERE sc.organization_id <> r.organization_id` },
  { id: 'assignment.bed', label: 'Assignment -> Bed         (org must match)', sql: `SELECT ba.id FROM bed_assignments ba JOIN beds b ON b.id = ba.bed_id WHERE ba.organization_id <> b.organization_id` },
  { id: 'assignment.resident', label: 'Assignment -> Resident   (org must match)', sql: `SELECT ba.id FROM bed_assignments ba JOIN residents r ON r.id = ba.resident_id WHERE ba.organization_id <> r.organization_id` },
  { id: 'assignment.contract', label: 'Assignment -> Contract   (org must match)', sql: `SELECT ba.id FROM bed_assignments ba JOIN stay_contracts sc ON sc.id = ba.contract_id WHERE ba.organization_id <> sc.organization_id` },
  { id: 'charge.resident', label: 'Charge -> Resident        (org must match)', sql: `SELECT c.id FROM charges c JOIN residents r ON r.id = c.resident_id WHERE c.organization_id <> r.organization_id` },
  { id: 'charge.contract', label: 'Charge -> Contract        (org must match)', sql: `SELECT c.id FROM charges c JOIN stay_contracts sc ON sc.id = c.contract_id WHERE c.organization_id <> sc.organization_id` },
  { id: 'payment.resident', label: 'Payment -> Resident       (org must match)', sql: `SELECT p.id FROM payments p JOIN residents r ON r.id = p.resident_id WHERE p.organization_id <> r.organization_id` },
  { id: 'deposit.resident', label: 'Deposit -> Resident       (org must match)', sql: `SELECT dt.id FROM deposit_transactions dt JOIN residents r ON r.id = dt.resident_id WHERE dt.organization_id <> r.organization_id` },
  { id: 'expense.hostel', label: 'Expense -> Hostel          (org must match)', sql: `SELECT e.id FROM expenses e JOIN hostels h ON h.id = e.hostel_id WHERE e.organization_id <> h.organization_id` },
  { id: 'allocation.org', label: 'Allocation: payment.org vs charge.org', sql: `SELECT pa.payment_id AS id_a, pa.charge_id AS id_b FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id JOIN charges c ON c.id = pa.charge_id WHERE p.organization_id <> c.organization_id` },
];

const CROSS_RESIDENT_CHECKS = [
  { id: 'assignment.contract', label: 'Assignment: resident vs its contract resident', sql: `SELECT ba.id FROM bed_assignments ba JOIN stay_contracts sc ON sc.id = ba.contract_id WHERE ba.resident_id <> sc.resident_id` },
  { id: 'charge.contract', label: 'Charge: resident vs its contract resident', sql: `SELECT c.id FROM charges c JOIN stay_contracts sc ON sc.id = c.contract_id WHERE c.resident_id <> sc.resident_id` },
  { id: 'allocation.resident', label: 'Allocation: payment.resident vs charge.resident', sql: `SELECT pa.payment_id AS id_a, pa.charge_id AS id_b FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id JOIN charges c ON c.id = pa.charge_id WHERE p.resident_id <> c.resident_id` },
];

const ORPHAN_CHECKS = [
  { id: 'room.hostel', label: 'Room without Hostel', sql: `SELECT r.id FROM rooms r LEFT JOIN hostels h ON h.id = r.hostel_id WHERE h.id IS NULL` },
  { id: 'bed.room', label: 'Bed without Room', sql: `SELECT b.id FROM beds b LEFT JOIN rooms r ON r.id = b.room_id WHERE r.id IS NULL` },
  { id: 'contract.hostel', label: 'Contract without Hostel', sql: `SELECT sc.id FROM stay_contracts sc LEFT JOIN hostels h ON h.id = sc.hostel_id WHERE h.id IS NULL` },
  { id: 'contract.resident', label: 'Contract without Resident', sql: `SELECT sc.id FROM stay_contracts sc LEFT JOIN residents r ON r.id = sc.resident_id WHERE r.id IS NULL` },
  { id: 'assignment.bed', label: 'Assignment without Bed', sql: `SELECT ba.id FROM bed_assignments ba LEFT JOIN beds b ON b.id = ba.bed_id WHERE b.id IS NULL` },
  { id: 'assignment.resident', label: 'Assignment without Resident', sql: `SELECT ba.id FROM bed_assignments ba LEFT JOIN residents r ON r.id = ba.resident_id WHERE r.id IS NULL` },
  { id: 'assignment.contract', label: 'Assignment without Contract', sql: `SELECT ba.id FROM bed_assignments ba LEFT JOIN stay_contracts sc ON sc.id = ba.contract_id WHERE sc.id IS NULL` },
  { id: 'charge.resident', label: 'Charge without Resident', sql: `SELECT c.id FROM charges c LEFT JOIN residents r ON r.id = c.resident_id WHERE r.id IS NULL` },
  { id: 'charge.contract', label: 'Charge (contract_id set) with missing contract', sql: `SELECT c.id FROM charges c LEFT JOIN stay_contracts sc ON sc.id = c.contract_id WHERE c.contract_id IS NOT NULL AND sc.id IS NULL` },
  { id: 'payment.resident', label: 'Payment without Resident', sql: `SELECT p.id FROM payments p LEFT JOIN residents r ON r.id = p.resident_id WHERE r.id IS NULL` },
  { id: 'deposit.resident', label: 'Deposit without Resident', sql: `SELECT dt.id FROM deposit_transactions dt LEFT JOIN residents r ON r.id = dt.resident_id WHERE r.id IS NULL` },
  { id: 'allocation.payment', label: 'Allocation without Payment', sql: `SELECT pa.charge_id AS id FROM payment_allocations pa LEFT JOIN payments p ON p.id = pa.payment_id WHERE p.id IS NULL` },
  { id: 'allocation.charge', label: 'Allocation without Charge', sql: `SELECT pa.payment_id AS id FROM payment_allocations pa LEFT JOIN charges c ON c.id = pa.charge_id WHERE c.id IS NULL` },
];

const COMPOSITE_PARENTS = ['hostels', 'rooms', 'beds', 'residents', 'stay_contracts'];

function sample(r) {
  if (r.id_a && r.id_b) return `${r.id_a} / ${r.id_b}`;
  return r.id != null ? r.id : '(none)';
}

async function runChecks(client, checks) {
  const out = [];
  for (const chk of checks) {
    const res = await client.query(chk.sql);
    out.push({ id: chk.id, label: chk.label, count: res.rows.length, sample: res.rows.slice(0, 5).map(sample) });
  }
  return out;
}

async function compositeReadiness(client) {
  const out = [];
  for (const tbl of COMPOSITE_PARENTS) {
    const res = await client.query(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass AND contype IN ('p','u') ORDER BY conname`,
      [tbl],
    );
    const hasOrgId = res.rows.some((r) => r.def.includes('organization_id') && /\bid\b/.test(r.def));
    out.push({ table: tbl, ok: hasOrgId, constraints: res.rows.map((r) => `${r.conname}: ${r.def}`) });
  }
  return out;
}

function printGroup(title, rows) {
  console.log(`## ${title}`);
  let total = 0;
  for (const r of rows) {
    total += r.count;
    console.log(`- ${r.label.padEnd(48)} count=${r.count}${r.count ? '  sample=' + JSON.stringify(r.sample) : ''}`);
  }
  console.log(`total: ${total}\n`);
  return total;
}

(async () => {
  assertAllowed(DB_URL);
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const crossOrg = await runChecks(client, CROSS_ORG_CHECKS);
    const crossRes = await runChecks(client, CROSS_RESIDENT_CHECKS);
    const orphan = await runChecks(client, ORPHAN_CHECKS);
    const composite = await compositeReadiness(client);
    await client.query('ROLLBACK');

    console.log('# M-2 READ-ONLY PREFLIGHT — relationship inventory & integrity');
    console.log(`database:    ${dbNameOf(DB_URL)}`);
    console.log('transaction: READ ONLY (BEGIN TRANSACTION READ ONLY; ROLLBACK)');
    console.log('');

    const totalCrossOrg = printGroup('Cross-organization mismatches (child.org != parent.org)', crossOrg);
    const totalCrossRes = printGroup('Cross-resident mismatches', crossRes);
    const totalOrphan = printGroup('Orphans / missing parents (FK-enforced, expect 0)', orphan);

    console.log('## Composite-key readiness (parent needs UNIQUE(organization_id, id) for composite FKs)');
    for (const c of composite) {
      console.log(`- ${c.table.padEnd(16)} UNIQUE(org,id)? ${c.ok ? 'YES' : 'NO'}`);
      for (const con of c.constraints) console.log(`    ${con}`);
    }
    console.log('');

    console.log('## Summary');
    console.log(`cross_org_mismatches:        ${totalCrossOrg}`);
    console.log(`cross_resident_mismatches:   ${totalCrossRes}`);
    console.log(`orphan_rows:                 ${totalOrphan}`);
    console.log(`parents missing UNIQUE(org,id): ${composite.filter((c) => !c.ok).length}/${composite.length}`);
  } finally {
    await client.end().catch(() => {});
  }
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});