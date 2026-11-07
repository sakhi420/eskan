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
  { id: 'absence.contract', label: 'Absence -> Contract       (org must match)', sql: `SELECT ta.id FROM temporary_absences ta JOIN stay_contracts sc ON sc.id = ta.contract_id WHERE ta.organization_id <> sc.organization_id` },
  { id: 'absence.resident', label: 'Absence -> Resident      (org must match)', sql: `SELECT ta.id FROM temporary_absences ta JOIN residents r ON r.id = ta.resident_id WHERE ta.organization_id <> r.organization_id` },
  { id: 'absence.creditCharge', label: 'Absence -> Credit Charge (org must match)', sql: `SELECT ta.id FROM temporary_absences ta JOIN charges c ON c.id = ta.credit_charge_id WHERE ta.organization_id <> c.organization_id` },
  { id: 'package.hostel', label: 'Package -> Hostel         (org must match)', sql: `SELECT p.id FROM accommodation_packages p JOIN hostels h ON h.id = p.hostel_id WHERE p.organization_id <> h.organization_id` },
  { id: 'contract.package', label: 'Contract -> Package       (org must match)', sql: `SELECT sc.id FROM stay_contracts sc JOIN accommodation_packages ap ON ap.id = sc.package_id WHERE sc.organization_id <> ap.organization_id` },
];

const CROSS_RESIDENT_CHECKS = [
  { id: 'assignment.contract', label: 'Assignment: resident vs its contract resident', sql: `SELECT ba.id FROM bed_assignments ba JOIN stay_contracts sc ON sc.id = ba.contract_id WHERE ba.resident_id <> sc.resident_id` },
  { id: 'charge.contract', label: 'Charge: resident vs its contract resident', sql: `SELECT c.id FROM charges c JOIN stay_contracts sc ON sc.id = c.contract_id WHERE c.resident_id <> sc.resident_id` },
  { id: 'allocation.resident', label: 'Allocation: payment.resident vs charge.resident', sql: `SELECT pa.payment_id AS id_a, pa.charge_id AS id_b FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id JOIN charges c ON c.id = pa.charge_id WHERE p.resident_id <> c.resident_id` },
  { id: 'absence.contract', label: 'Absence: resident vs its contract resident', sql: `SELECT ta.id FROM temporary_absences ta JOIN stay_contracts sc ON sc.id = ta.contract_id WHERE ta.resident_id <> sc.resident_id` },
  { id: 'absence.creditCharge', label: 'Absence: resident vs its creditCharge resident', sql: `SELECT ta.id FROM temporary_absences ta JOIN charges c ON c.id = ta.credit_charge_id WHERE ta.resident_id <> c.resident_id` },
];

const CROSS_HOSTEL_CHECKS = [
  { id: 'contract.package.hostel', label: 'Contract hostel vs its package hostel', sql: `SELECT sc.id FROM stay_contracts sc JOIN accommodation_packages ap ON ap.id = sc.package_id WHERE ap.hostel_id IS NOT NULL AND sc.hostel_id <> ap.hostel_id` },
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
  { id: 'absence.resident', label: 'Absence without Resident', sql: `SELECT ta.id FROM temporary_absences ta LEFT JOIN residents r ON r.id = ta.resident_id WHERE r.id IS NULL` },
  { id: 'absence.contract', label: 'Absence without Contract', sql: `SELECT ta.id FROM temporary_absences ta LEFT JOIN stay_contracts sc ON sc.id = ta.contract_id WHERE sc.id IS NULL` },
  { id: 'absence.creditCharge', label: 'Absence (creditChargeId set) with missing charge', sql: `SELECT ta.id FROM temporary_absences ta LEFT JOIN charges c ON c.id = ta.credit_charge_id WHERE ta.credit_charge_id IS NOT NULL AND c.id IS NULL` },
  { id: 'package.hostel', label: 'Package (hostelId set) with missing hostel', sql: `SELECT p.id FROM accommodation_packages p LEFT JOIN hostels h ON h.id = p.hostel_id WHERE p.hostel_id IS NOT NULL AND h.id IS NULL` },
  { id: 'contract.package', label: 'Contract (packageId set) with missing package', sql: `SELECT sc.id FROM stay_contracts sc LEFT JOIN accommodation_packages ap ON ap.id = sc.package_id WHERE sc.package_id IS NOT NULL AND ap.id IS NULL` },
];

// Required tenant-scoped unique keys (prerequisites for composite FKs). Each key
// must exist on the parent table EXACTLY (same columns, same order) before a
// composite FK can reference it. Sourced from docs/project/phase-9-engineering-plan.md.
// NOTE: temporary_absences only needs the 3-column key — there is no referencing
// relation that consumes a 2-column (organization_id, id) on it, so that key is
// intentionally NOT listed as a migration prerequisite.
const REQUIRED_KEYS = [
  { table: 'hostels', cols: ['organization_id', 'id'] },
  { table: 'rooms', cols: ['organization_id', 'id'] },
  { table: 'beds', cols: ['organization_id', 'id'] },
  { table: 'accommodation_packages', cols: ['organization_id', 'id'] },
  { table: 'residents', cols: ['organization_id', 'id'] },
  { table: 'stay_contracts', cols: ['organization_id', 'id'] },
  { table: 'stay_contracts', cols: ['organization_id', 'resident_id', 'id'] },
  { table: 'charges', cols: ['organization_id', 'id'] },
  { table: 'charges', cols: ['organization_id', 'resident_id', 'id'] },
  { table: 'payments', cols: ['organization_id', 'id'] },
  { table: 'payments', cols: ['organization_id', 'resident_id', 'id'] },
  { table: 'temporary_absences', cols: ['organization_id', 'resident_id', 'id'] },
];

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
  // Enumerate the ordered column list of every unique (non-partial) index per
  // table, then check for an EXACT match against each required key (same
  // columns, same order) — a 3-column UNIQUE does not satisfy a 2-column key.
  const res = await client.query(
    `SELECT t.relname AS tbl, i.relname AS idx, array_agg(a.attname ORDER BY k.ord) AS cols
     FROM pg_index x
     JOIN pg_class t ON t.oid = x.indrelid
     JOIN pg_class i ON i.oid = x.indexrelid
     CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE x.indisunique AND x.indpred IS NULL AND x.indisvalid AND x.indisready AND k.ord <= (x.indnkeyatts)::bigint
     GROUP BY t.relname, i.relname
     ORDER BY t.relname, i.relname`,
  );
  const idxByTable = {};
  for (const row of res.rows) (idxByTable[row.tbl] ||= []).push({ idx: row.idx, cols: row.cols });
  return REQUIRED_KEYS.map((req) => {
    const exact = (idxByTable[req.table] || []).filter(
      (ix) => ix.cols.length === req.cols.length && ix.cols.every((c, j) => c === req.cols[j]),
    );
    return { table: req.table, key: req.cols.join(', '), ok: exact.length > 0, matchedBy: exact.map((ix) => ix.idx) };
  });
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
    const crossHostel = await runChecks(client, CROSS_HOSTEL_CHECKS);
    const orphan = await runChecks(client, ORPHAN_CHECKS);
    const composite = await compositeReadiness(client);
    await client.query('ROLLBACK');

    console.log('# M-2 READ-ONLY PREFLIGHT — relationship inventory & integrity');
    console.log(`database:    ${dbNameOf(DB_URL)}`);
    console.log('transaction: READ ONLY (BEGIN TRANSACTION READ ONLY; ROLLBACK)');
    console.log('');

    const totalCrossOrg = printGroup('Cross-organization mismatches (child.org != parent.org)', crossOrg);
    const totalCrossRes = printGroup('Cross-resident mismatches', crossRes);
    const totalCrossHostel = printGroup('Cross-hostel mismatches (contract.hostel vs package.hostel)', crossHostel);
    const totalOrphan = printGroup('Orphans / missing parents (FK-enforced, expect 0)', orphan);

    console.log('## Composite-key readiness (required UNIQUE keys for tenant-scoped composite FKs)');
    for (const c of composite) {
      console.log(`- ${c.table.padEnd(18)} (${c.key}) ${c.ok ? 'PRESENT' : 'MISSING'}${c.ok ? '  via ' + c.matchedBy.join(', ') : ''}`);
    }
    console.log('');

    console.log('## Summary');
    console.log(`cross_org_mismatches:        ${totalCrossOrg}`);
    console.log(`cross_resident_mismatches:   ${totalCrossRes}`);
    console.log(`cross_hostel_mismatches:     ${totalCrossHostel}`);
    console.log(`orphan_rows:                 ${totalOrphan}`);
    console.log(`missing required UNIQUE keys: ${composite.filter((c) => !c.ok).length}/${composite.length}`);

    if (process.argv.includes('--strict') && (totalCrossOrg > 0 || totalCrossRes > 0 || totalCrossHostel > 0 || totalOrphan > 0)) {
      console.error(`STRICT: anomalies detected (cross_org=${totalCrossOrg}, cross_resident=${totalCrossRes}, cross_hostel=${totalCrossHostel}, orphan=${totalOrphan}); failing.`);
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => {});
  }
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});