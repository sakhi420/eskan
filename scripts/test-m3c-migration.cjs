'use strict';
const { Client } = require('pg');
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
async function errCode(c, sql, params = []) { try { await c.query(sql, params); return null; } catch (e) { return e.code || String(e.message); } }
async function transactionCode(c, work) {
  await c.query('BEGIN');
  try {
    await work();
    await c.query('COMMIT');
    return null;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return e.code || String(e.message);
  }
}
async function newDb(admin, tag) {
  const name = `eskan_m3c_${tag}_${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const c = new Client({ connectionString: dbUrl(name) });
  await c.connect();
  return { name, c };
}
async function applyMigrations(c, list) { for (const m of list) await c.query(m.sql); }
async function seedOrgRes(c) {
  const org = uuid(), user = uuid(), res = uuid();
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await c.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`, [user, `u-${uuid().slice(0, 8)}@e.com`]);
  await c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [res, org]);
  return { org, user, res };
}
async function seedCharge(c, org, res, amount) {
  const id = uuid();
  await c.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER',$4,'2026-11-01','2026-12-01','2026-11-01',now())`, [id, org, res, amount]);
  return id;
}
async function seedPayment(c, org, res, amount) {
  const id = uuid();
  await c.query(`INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at) VALUES ($1,$2,$3,$4,'CASH','2026-11-02','RC-${uuid().slice(0,6)}',now())`, [id, org, res, amount]);
  return id;
}
async function seedDeposit(c, org, res, amount) {
  const id = uuid();
  await c.query(`INSERT INTO deposit_transactions (id, organization_id, resident_id, type, status, amount, received_at, updated_at) VALUES ($1,$2,$3,'RECEIVED','POSTED',$4,'2026-11-02',now())`, [id, org, res, amount]);
  return id;
}

(async () => {
  assertLocalTestHost();
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  const migrations = readMigrations();
  const m3cMigrations = migrations.filter((m) => m.name.includes('m3c_'));
  const preM3cMigrations = migrations.filter((m) => !m.name.includes('m3c_'));
  check('[m3c migrations present]', m3cMigrations.length === 2, `count=${m3cMigrations.length}`);

  // Construct a pre-M3c schema, seed representative M3b financial rows,
  // then apply only M3c migrations. This is a true baseline-upgrade rehearsal.
  const baseline = await newDb(admin, 'baseline');
  await applyMigrations(baseline.c, preM3cMigrations);
  const baselineTables = await baseline.c.query(
    `SELECT to_regclass('public.payments') AS payments,
            to_regclass('public.payment_allocations') AS allocations,
            to_regclass('public.ledger_reversals') AS reversals`,
  );
  check('[baseline: pre-M3c schema]',
    Boolean(baselineTables.rows[0].payments) &&
    Boolean(baselineTables.rows[0].allocations) &&
    baselineTables.rows[0].reversals === null);

  const baselineFixture = await seedOrgRes(baseline.c);
  const baselineCharge = await seedCharge(baseline.c, baselineFixture.org, baselineFixture.res, 7000);
  const baselinePayment = await seedPayment(baseline.c, baselineFixture.org, baselineFixture.res, 5000);
  const baselineAllocation = uuid();
  await baseline.c.query(
    `INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount)
     VALUES ($1,$2,$3,$4,$5,2000)`,
    [baselineAllocation, baselineFixture.org, baselineFixture.res, baselinePayment, baselineCharge],
  );
  await applyMigrations(baseline.c, m3cMigrations);
  const preserved = await baseline.c.query(
    `SELECT
       (SELECT count(*)::int FROM payments WHERE id=$1 AND amount=5000) AS payment_count,
       (SELECT count(*)::int FROM charges WHERE id=$2 AND amount=7000) AS charge_count,
       (SELECT count(*)::int FROM payment_allocations WHERE id=$3 AND amount=2000) AS allocation_count,
       (SELECT to_regclass('public.deposit_applications')) AS applications`,
    [baselinePayment, baselineCharge, baselineAllocation],
  );
  check('[baseline: M3b financial rows preserved after M3c upgrade]',
    preserved.rows[0].payment_count === 1 &&
    preserved.rows[0].charge_count === 1 &&
    preserved.rows[0].allocation_count === 1 &&
    preserved.rows[0].applications === 'deposit_applications');

  // The legacy schema has DepositType REFUNDED/FORFEITED but no source link.
  // M3c must stop rather than silently omit these rows from source balances.
  const legacyChild = await newDb(admin, 'legacy_child');
  await applyMigrations(legacyChild.c, preM3cMigrations);
  const legacyFixture = await seedOrgRes(legacyChild.c);
  await legacyChild.c.query(
    `INSERT INTO deposit_transactions
       (id, organization_id, resident_id, type, status, amount, received_at, updated_at)
     VALUES ($1,$2,$3,'REFUNDED','POSTED',100,'2026-11-02',now())`,
    [uuid(), legacyFixture.org, legacyFixture.res],
  );
  let legacyPreflightError = null;
  try {
    await applyMigrations(legacyChild.c, [m3cMigrations[0]]);
  } catch (e) {
    legacyPreflightError = e;
  }
  check(
    '[preflight: rejects legacy refund/forfeit events before any M3c DDL]',
    !!legacyPreflightError &&
      String(legacyPreflightError.message).includes('legacy REFUNDED/FORFEITED'),
    legacyPreflightError
      ? String(legacyPreflightError.message)
      : 'migration unexpectedly succeeded',
  );
  const legacyAfterFailure = await legacyChild.c.query(
    `SELECT
       to_regtype('public."ReversalSourceType"') IS NULL AS enum_absent,
       to_regclass('public.ledger_reversals') IS NULL AS table_absent,
       NOT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='deposit_transactions'
            AND column_name='actor_user_id'
       ) AS actor_column_absent`,
  );
  check(
    '[preflight: first migration leaves no partial M3c schema behind]',
    legacyAfterFailure.rows[0].enum_absent &&
      legacyAfterFailure.rows[0].table_absent &&
      legacyAfterFailure.rows[0].actor_column_absent,
  );

  const fresh = await newDb(admin, 'fresh');
  let applyErr = null;
  try { await applyMigrations(fresh.c, migrations); } catch (e) { applyErr = e; }
  check('[fresh: all migrations apply]', !applyErr, applyErr ? applyErr.message : '');

  const { org, user, res } = await seedOrgRes(fresh.c);
  const res2 = uuid();
  await fresh.c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R2',now())`, [res2, org]);
  const org2 = uuid();
  await fresh.c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org2',now())`, [org2]);
  const resOrg2 = uuid();
  await fresh.c.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RO2',now())`, [resOrg2, org2]);

  const enumPayment = await fresh.c.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='PaymentMethod'`);
  check('[enum DEPOSIT_APPLICATION]', enumPayment.rows.some((r) => r.enumlabel === 'DEPOSIT_APPLICATION'));
  const enumRev = await fresh.c.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='ReversalSourceType' ORDER BY enumsortorder`);
  check('[enum ReversalSourceType]', JSON.stringify(enumRev.rows.map((r) => r.enumlabel)) === JSON.stringify(['CHARGE', 'PAYMENT', 'DEPOSIT', 'EXPENSE']));

  check('[col deposit.actor_user_id]', !!(await fresh.c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='deposit_transactions' AND column_name='actor_user_id'`)).rows[0]);
  check('[col expense.actor_user_id]', !!(await fresh.c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='actor_user_id'`)).rows[0]);
  const receiptNull = await fresh.c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='payments' AND column_name='receipt_number'`);
  check('[col receipt_number nullable]', receiptNull.rows[0].is_nullable === 'YES');

  for (const t of ['ledger_reversals', 'payment_refunds', 'deposit_applications']) {
    const r = await fresh.c.query(`SELECT to_regclass('public."${t}"') AS t`);
    check(`[table ${t}]`, r.rows[0].t === t);
  }

  const checks = await fresh.c.query(`SELECT conname FROM pg_constraint WHERE contype='c' AND conname LIKE '%_amount_positive' ORDER BY conname`);
  const checkNames = checks.rows.map((r) => r.conname);
  for (const n of ['ledger_reversals_amount_positive', 'payment_refunds_amount_positive', 'deposit_applications_amount_positive']) check(`[check ${n}]`, checkNames.includes(n));

  const triggers = await fresh.c.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%_prevent_delete' ORDER BY tgname`);
  const triggerNames = triggers.rows.map((r) => r.tgname);
  for (const t of ['deposit_transactions_prevent_delete', 'expenses_prevent_delete', 'ledger_reversals_prevent_delete', 'payment_refunds_prevent_delete', 'deposit_applications_prevent_delete']) check(`[trigger ${t}]`, triggerNames.includes(t));
  for (const trigger of [
    'deposit_transactions_prevent_update',
    'deposit_applications_validate_links',
    'payment_allocations_enforce_dapp_single_allocation',
    'payments_enforce_dapp_initial_state',
    'payments_prevent_dapp_identity_update',
    'payments_dapp_reversal_requires_application',
    'payment_allocations_prevent_dapp_update',
    'deposit_applications_prevent_link_update',
    'allocation_releases_prevent_update',
    'allocation_releases_enforce_invariants',
    'ledger_reversals_validate_deposit_source',
    'ledger_reversals_prevent_update',
    'payment_refunds_prevent_update',
    'expenses_prevent_financial_identity_update',
    'charges_prevent_reverse_with_active_deposit_application',
  ]) {
    const found = await fresh.c.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname=$1`, [trigger]);
    check(`[trigger ${trigger}]`, found.rowCount === 1);
  }

  const depositReversalIndex = await fresh.c.query(
    `SELECT indexname FROM pg_indexes WHERE indexname='ledger_reversals_deposit_source_unique'`,
  );
  check('[index: one DEPOSIT reversal per source]', depositReversalIndex.rowCount === 1);

  const fks = await fresh.c.query(`SELECT conname FROM pg_constraint WHERE contype='f' AND array_length(conkey, 1) >= 2 ORDER BY conname`);
  const fkNames = new Set(fks.rows.map((r) => r.conname));
  const m3cCompositeFks = [
    'ledger_reversals_organization_id_resident_id_fkey',
    'payment_refunds_organization_id_resident_id_fkey',
    'payment_refunds_organization_id_resident_id_payment_id_fkey',
    'deposit_applications_organization_id_resident_id_fkey',
    'deposit_applications_organization_id_resident_id_deposit_t_fkey',
    'deposit_applications_organization_id_resident_id_charge_id_fkey',
    'deposit_transactions_organization_id_resident_id_source_de_fkey',
    'deposit_applications_organization_id_resident_id_payment_i_fkey',
    'deposit_applications_organization_id_resident_id_allocatio_fkey',
  ];
  const presentM3cCompositeFks = m3cCompositeFks.filter((name) => fkNames.has(name));
  check(
    '[fk: all 9 M3c composite FKs present]',
    m3cCompositeFks.length === 9 && presentM3cCompositeFks.length === 9,
    `expected=9 actual=${presentM3cCompositeFks.length} names=${presentM3cCompositeFks.join(',')}`,
  );

  const sourceCol = await fresh.c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='deposit_transactions' AND column_name='source_deposit_transaction_id'`);
  check('[col deposit.source_deposit_transaction_id]', !!sourceCol.rows[0] && sourceCol.rows[0].is_nullable === 'YES');
  const appPay = await fresh.c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='deposit_applications' AND column_name='payment_id'`);
  check('[col application.payment_id NOT NULL]', !!appPay.rows[0] && appPay.rows[0].is_nullable === 'NO');
  const appAlloc = await fresh.c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='deposit_applications' AND column_name='allocation_id'`);
  check('[col application.allocation_id NOT NULL]', !!appAlloc.rows[0] && appAlloc.rows[0].is_nullable === 'NO');

  const dappReceipt = await fresh.c.query(`SELECT conname FROM pg_constraint WHERE conname='payments_dapp_has_no_receipt'`);
  check('[check: payments_dapp_has_no_receipt]', dappReceipt.rows.length > 0);
  const manualReceipt = await fresh.c.query(`SELECT conname FROM pg_constraint WHERE conname='payments_manual_requires_receipt'`);
  check('[check: payments_manual_requires_receipt]', manualReceipt.rows.length > 0);
  const expMethod = await fresh.c.query(`SELECT conname FROM pg_constraint WHERE conname='expenses_payment_method_not_dapp'`);
  check('[check: expenses_payment_method_not_dapp]', expMethod.rows.length > 0);

  const depRecv = await seedDeposit(fresh.c, org, res, 10000);
  check('[source: RECEIVED cannot have a parent link]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_transactions
         (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
       VALUES ($1,$2,$3,$4,'RECEIVED','POSTED',10,'2026-11-02',now())`,
      [uuid(), org, res, depRecv],
    )) === '23514');
  check('[source: REFUNDED requires a source]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_transactions
         (id,organization_id,resident_id,type,status,amount,received_at,updated_at)
       VALUES ($1,$2,$3,'REFUNDED','POSTED',10,'2026-11-02',now())`,
      [uuid(), org, res],
    )) === '23514');
  check(
    '[source: new child events cannot be inserted already REVERSED]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_transactions
         (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
       VALUES ($1,$2,$3,$4,'REFUNDED','REVERSED',10,'2026-11-02',now())`,
      [uuid(), org, res, depRecv],
    )) === '23514',
  );
  const childRefund = uuid();
  await fresh.c.query(
    `INSERT INTO deposit_transactions
       (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
     VALUES ($1,$2,$3,$4,'REFUNDED','POSTED',10,'2026-11-02',now())`,
    [childRefund, org, res, depRecv],
  );
  check('[source: nested refund cannot be used as a source]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_transactions
         (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
       VALUES ($1,$2,$3,$4,'FORFEITED','POSTED',10,'2026-11-02',now())`,
      [uuid(), org, res, childRefund],
    )) === '23514');

  // Deposit reversal is source-aware and serialized by the RECEIVED row lock.
  const reversalGuardDeposit = await seedDeposit(fresh.c, org, res, 100);
  const reversalGuardChild = uuid();
  await fresh.c.query(
    `INSERT INTO deposit_transactions
       (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
     VALUES ($1,$2,$3,$4,'REFUNDED','POSTED',40,'2026-11-02',now())`,
    [reversalGuardChild, org, res, reversalGuardDeposit],
  );
  check(
    '[deposit reversal: RECEIVED blocked while child event is active]',
    (await errCode(
      fresh.c,
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'DEPOSIT',$4,'DEBIT',100,'source too early',$5,$6)`,
      [uuid(), org, res, reversalGuardDeposit, user, uuid()],
    )) === '23514',
  );
  check(
    '[deposit reversal: child REFUNDED event can be reversed while source is active]',
    (await errCode(
      fresh.c,
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'DEPOSIT',$4,'CREDIT',40,'reverse child first',$5,$6)`,
      [uuid(), org, res, reversalGuardChild, user, uuid()],
    )) === null,
  );
  check(
    '[deposit reversal: RECEIVED succeeds after child reversal]',
    (await errCode(
      fresh.c,
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'DEPOSIT',$4,'DEBIT',100,'reverse source second',$5,$6)`,
      [uuid(), org, res, reversalGuardDeposit, user, uuid()],
    )) === null,
  );
  check(
    '[deposit reversal: duplicate source reversal rejected]',
    (await errCode(
      fresh.c,
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'DEPOSIT',$4,'DEBIT',100,'duplicate source reversal',$5,$6)`,
      [uuid(), org, res, reversalGuardDeposit, user, uuid()],
    )) === '23505',
  );
  check(
    '[deposit reversal: child event cannot be reversed twice]',
    (await errCode(
      fresh.c,
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'DEPOSIT',$4,'CREDIT',40,'duplicate child reversal',$5,$6)`,
      [uuid(), org, res, reversalGuardChild, user, uuid()],
    )) === '23505',
  );
  check(
    '[deposit reversal: child event cannot be created after source reversal]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_transactions
         (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
       VALUES ($1,$2,$3,$4,'FORFEITED','POSTED',1,'2026-11-02',now())`,
      [uuid(), org, res, reversalGuardDeposit],
    )) === '23514',
  );

  // A single source deposit has one combined balance across refunds, forfeits,
  // and DAPP applications; no individual event type gets a separate allowance.
  const balanceDeposit = await seedDeposit(fresh.c, org, res, 100);
  await fresh.c.query(
    `INSERT INTO deposit_transactions
       (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
     VALUES ($1,$2,$3,$4,'REFUNDED','POSTED',60,'2026-11-02',now())`,
    [uuid(), org, res, balanceDeposit],
  );
  await fresh.c.query(
    `INSERT INTO deposit_transactions
       (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
     VALUES ($1,$2,$3,$4,'FORFEITED','POSTED',30,'2026-11-02',now())`,
    [uuid(), org, res, balanceDeposit],
  );
  check(
    '[source balance: refund + forfeit cannot exceed RECEIVED amount]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_transactions
         (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
       VALUES ($1,$2,$3,$4,'FORFEITED','POSTED',11,'2026-11-02',now())`,
      [uuid(), org, res, balanceDeposit],
    )) === '23514',
  );

  const excessBalanceCharge = await seedCharge(fresh.c, org, res, 11);
  const excessBalancePayment = uuid();
  await fresh.c.query(
    `INSERT INTO payments
       (id,organization_id,resident_id,amount,method,received_at,receipt_number,updated_at)
     VALUES ($1,$2,$3,11,'DEPOSIT_APPLICATION','2026-11-02',NULL,now())`,
    [excessBalancePayment, org, res],
  );
  const excessBalanceAllocation = uuid();
  await fresh.c.query(
    `INSERT INTO payment_allocations
       (id,organization_id,resident_id,payment_id,charge_id,amount)
     VALUES ($1,$2,$3,$4,$5,11)`,
    [excessBalanceAllocation, org, res, excessBalancePayment, excessBalanceCharge],
  );
  check(
    '[source balance: DAPP cannot exceed balance after refund and forfeit]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_applications
         (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,amount,reason,actor_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,11,'overdraw source',$8)`,
      [uuid(), org, res, balanceDeposit, excessBalanceCharge, excessBalancePayment, excessBalanceAllocation, user],
    )) === '23514',
  );

  const balanceCharge = await seedCharge(fresh.c, org, res, 10);
  const balancePayment = uuid();
  await fresh.c.query(
    `INSERT INTO payments
       (id,organization_id,resident_id,amount,method,received_at,receipt_number,updated_at)
     VALUES ($1,$2,$3,10,'DEPOSIT_APPLICATION','2026-11-02',NULL,now())`,
    [balancePayment, org, res],
  );
  const balanceAllocation = uuid();
  await fresh.c.query(
    `INSERT INTO payment_allocations
       (id,organization_id,resident_id,payment_id,charge_id,amount)
     VALUES ($1,$2,$3,$4,$5,10)`,
    [balanceAllocation, org, res, balancePayment, balanceCharge],
  );
  await fresh.c.query(
    `INSERT INTO deposit_applications
       (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,amount,reason,actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,10,'remaining source balance',$8)`,
    [uuid(), org, res, balanceDeposit, balanceCharge, balancePayment, balanceAllocation, user],
  );
  check(
    '[source balance: DAPP cannot exceed balance after refund and forfeit]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_transactions
         (id,organization_id,resident_id,source_deposit_transaction_id,type,status,amount,received_at,updated_at)
       VALUES ($1,$2,$3,$4,'FORFEITED','POSTED',1,'2026-11-02',now())`,
      [uuid(), org, res, balanceDeposit],
    )) === '23514',
  );

  const charge = await seedCharge(fresh.c, org, res, 10000);
  const charge2 = await seedCharge(fresh.c, org, res2, 10000);
  const pay = await seedPayment(fresh.c, org, res, 10000);
  const allocDummy = uuid();
  await fresh.c.query(`INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount) VALUES ($1,$2,$3,$4,$5,1)`, [allocDummy, org, res, pay, charge]);
  check(
    '[allocation release: cumulative release cannot exceed allocation amount]',
    (await errCode(
      fresh.c,
      `INSERT INTO allocation_releases
         (id,organization_id,resident_id,allocation_id,amount,reason,actor_user_id,created_at)
       VALUES ($1,$2,$3,$4,2,'over-release',$5,now())`,
      [uuid(), org, res, allocDummy, user],
    )) === '23514',
  );

  check('[check: refund amount=0]', (await errCode(fresh.c, `INSERT INTO payment_refunds (id,organization_id,resident_id,payment_id,amount,reason,actor_user_id) VALUES ($1,$2,$3,$4,0,'x',$5)`, [uuid(), org, res, pay, user])) === '23514');
  check('[check: reversal amount=0]', (await errCode(fresh.c, `INSERT INTO ledger_reversals (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key) VALUES ($1,$2,$3,'CHARGE',$4,'DEBIT',0,'x',$5,$6)`, [uuid(), org, res, charge, user, uuid()])) === '23514');
  check('[check: application amount<0]', (await errCode(fresh.c, `INSERT INTO deposit_applications (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,amount,reason,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,-5,'x',$8)`, [uuid(), org, res, depRecv, charge, pay, allocDummy, user])) === '23514');

  check('[fk: cross-resident refund]', (await errCode(fresh.c, `INSERT INTO payment_refunds (id,organization_id,resident_id,payment_id,amount,reason,actor_user_id) VALUES ($1,$2,$3,$4,100,'x',$5)`, [uuid(), org, res2, pay, user])) !== null);
  check('[fk: cross-org application]', (await errCode(fresh.c, `INSERT INTO deposit_applications (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,amount,reason,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,100,'x',$8)`, [uuid(), org2, resOrg2, depRecv, charge2, pay, allocDummy, user])) !== null);

  check('[immutability: deposit delete]', (await errCode(fresh.c, `DELETE FROM deposit_transactions WHERE id=$1`, [depRecv])) === 'P0001');
  check('[immutability: deposit update]', (await errCode(fresh.c, `UPDATE deposit_transactions SET reason='tampered' WHERE id=$1`, [depRecv])) === 'P0001');

  check(
    '[DAPP Payment: cannot be inserted already REVERSED]',
    (await errCode(
      fresh.c,
      `INSERT INTO payments
         (id,organization_id,resident_id,status,amount,method,received_at,receipt_number,reversed_by_id,reversal_reason,reversed_at,updated_at)
       VALUES ($1,$2,$3,'REVERSED',100,'DEPOSIT_APPLICATION','2026-11-02',NULL,$4,'forged initial reversal',now(),now())`,
      [uuid(), org, res, user],
    )) === '23514',
  );

  const reversedAtInsertPayment = uuid();
  await fresh.c.query(
    `INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at)
     VALUES ($1,$2,$3,100,'DEPOSIT_APPLICATION','2026-11-02',NULL,now())`,
    [reversedAtInsertPayment, org, res],
  );
  const reversedAtInsertAllocation = uuid();
  await fresh.c.query(
    `INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount)
     VALUES ($1,$2,$3,$4,$5,100)`,
    [reversedAtInsertAllocation, org, res, reversedAtInsertPayment, charge],
  );
  check(
    '[DAPP: cannot be inserted already REVERSED]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_applications
         (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,status,amount,reason,actor_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'REVERSED',100,'invalid initial state',$8)`,
      [uuid(), org, res, depRecv, charge, reversedAtInsertPayment, reversedAtInsertAllocation, user],
    )) === '23514',
  );

  const internalPayment = uuid();
  await fresh.c.query(
    `INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at)
     VALUES ($1,$2,$3,100,'DEPOSIT_APPLICATION','2026-11-02',NULL,now())`,
    [internalPayment, org, res],
  );
  check('[receipt: ordinary CASH payment cannot omit receipt number]',
    (await errCode(fresh.c,
      `INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at)
       VALUES ($1,$2,$3,100,'CASH','2026-11-02',NULL,now())`,
      [uuid(), org, res])) === '23514');
  check('[receipt: DAPP cannot carry an official receipt number]',
    (await errCode(fresh.c,
      `INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at)
       VALUES ($1,$2,$3,100,'DEPOSIT_APPLICATION','2026-11-02','SHOULD-NOT-EXIST',now())`,
      [uuid(), org, res])) === '23514');

  const internalCharge = await seedCharge(fresh.c, org, res, 1000);
  const internalAllocation = uuid();
  await fresh.c.query(
    `INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount)
     VALUES ($1,$2,$3,$4,$5,100)`,
    [internalAllocation, org, res, internalPayment, internalCharge],
  );
  const otherInternalCharge = await seedCharge(fresh.c, org, res, 1000);
  check('[DAPP: rejects second allocation]',
    (await errCode(fresh.c,
      `INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount)
       VALUES ($1,$2,$3,$4,$5,100)`,
      [uuid(), org, res, internalPayment, otherInternalCharge])) === '23514');

  check('[DAPP: payment financial identity immutable]',
    (await errCode(fresh.c, `UPDATE payments SET amount=101 WHERE id=$1`, [internalPayment])) === 'P0001');
  check('[payment: cannot convert a receipt into DAPP]',
    (await errCode(fresh.c, `UPDATE payments SET method='DEPOSIT_APPLICATION' WHERE id=$1`, [pay])) === 'P0001');

  const validApplication = uuid();
  await fresh.c.query(
    `INSERT INTO deposit_applications (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,amount,reason,actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,100,'valid linkage',$8)`,
    [validApplication, org, res, depRecv, internalCharge, internalPayment, internalAllocation, user],
  );
  // Clear the child event first so the following source-reversal failure is
  // specifically caused by the still-POSTED DepositApplication.
  check(
    '[deposit reversal: child event reversal before DAPP source test]',
    (await errCode(
      fresh.c,
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'DEPOSIT',$4,'CREDIT',10,'reverse child before application',$5,$6)`,
      [uuid(), org, res, childRefund, user, uuid()],
    )) === null,
  );
  check(
    '[deposit reversal: RECEIVED blocked while DAPP is POSTED]',
    (await errCode(
      fresh.c,
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'DEPOSIT',$4,'DEBIT',10000,'source held by DAPP',$5,$6)`,
      [uuid(), org, res, depRecv, user, uuid()],
    )) === '23514',
  );
  check(
    '[DAPP: active application blocks Charge reversal]',
    (await errCode(
      fresh.c,
      `UPDATE charges SET status='REVERSED' WHERE id=$1`,
      [internalCharge],
    )) === '23514',
  );
  check(
    '[DAPP: direct AllocationRelease is rejected while Payment is still POSTED]',
    (await errCode(
      fresh.c,
      `INSERT INTO allocation_releases
         (id,organization_id,resident_id,allocation_id,amount,reason,actor_user_id,created_at)
       VALUES ($1,$2,$3,$4,100,'unauthorized DAPP release',$5,now())`,
      [uuid(), org, res, internalAllocation, user],
    )) === '23514',
  );

  // Directly flipping Application status cannot create held-balance credit.
  check(
    '[DAPP: Application-only reversal is rejected]',
    (await errCode(
      fresh.c,
      `UPDATE deposit_applications
          SET status='REVERSED', reversed_by_id=$2, reversal_reason='forged app-only',
              reversed_at=now(), version=version+1
        WHERE id=$1`,
      [validApplication, user],
    )) === '23514',
  );

  // A DAPP Payment cannot be reversed alone; the deferred constraint is checked
  // at COMMIT, after all related writes in a legitimate transaction have run.
  const paymentOnlyError = await transactionCode(fresh.c, async () => {
    await fresh.c.query(
      `UPDATE payments
          SET status='REVERSED', reversed_by_id=$2, reversal_reason='payment only',
              reversed_at=now(), version=version+1
        WHERE id=$1`,
      [internalPayment, user],
    );
  });
  check('[DAPP: Payment-only reversal is rejected at commit]', paymentOnlyError === '23514');

  // Even a reversed Payment and full Release are insufficient without the
  // corresponding compensating LedgerReversal.
  const noLedgerError = await transactionCode(fresh.c, async () => {
    await fresh.c.query(
      `UPDATE payments
          SET status='REVERSED', reversed_by_id=$2, reversal_reason='missing ledger reversal',
              reversed_at=now(), version=version+1
        WHERE id=$1`,
      [internalPayment, user],
    );
    await fresh.c.query(
      `INSERT INTO allocation_releases
         (id,organization_id,resident_id,allocation_id,amount,reason,actor_user_id,created_at)
       VALUES ($1,$2,$3,$4,100,'missing ledger reversal',$5,now())`,
      [uuid(), org, res, internalAllocation, user],
    );
  });
  check('[DAPP: AllocationRelease requires the matching LedgerReversal]', noLedgerError === '23514');

  // A LedgerReversal without a full AllocationRelease also cannot unlock Held.
  const noReleaseError = await transactionCode(fresh.c, async () => {
    await fresh.c.query(
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'PAYMENT',$4,'DEBIT',100,'missing release',$5,$6)`,
      [uuid(), org, res, internalPayment, user, uuid()],
    );
    await fresh.c.query(
      `UPDATE payments
          SET status='REVERSED', reversed_by_id=$2, reversal_reason='missing release',
              reversed_at=now(), version=version+1
        WHERE id=$1`,
      [internalPayment, user],
    );
    await fresh.c.query(
      `UPDATE deposit_applications
          SET status='REVERSED', reversed_by_id=$2, reversal_reason='missing release',
              reversed_at=now(), version=version+1
        WHERE id=$1`,
      [validApplication, user],
    );
  });
  check('[DAPP: Application reversal requires a full AllocationRelease]', noReleaseError === '23514');

  const validDappReversalReason = 'valid complete DAPP reversal';
  const validDappReleaseId = uuid();
  const validDappReversal = await transactionCode(fresh.c, async () => {
    await fresh.c.query(
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'PAYMENT',$4,'DEBIT',100,$5,$6,$7)`,
      [uuid(), org, res, internalPayment, validDappReversalReason, user, uuid()],
    );
    await fresh.c.query(
      `UPDATE payments
          SET status='REVERSED', reversed_by_id=$2, reversal_reason=$3,
              reversed_at=now(), version=version+1
        WHERE id=$1`,
      [internalPayment, user, validDappReversalReason],
    );
    await fresh.c.query(
      `INSERT INTO allocation_releases
         (id,organization_id,resident_id,allocation_id,amount,reason,actor_user_id,created_at)
       VALUES ($1,$2,$3,$4,100,$5,$6,now())`,
      [validDappReleaseId, org, res, internalAllocation, validDappReversalReason, user],
    );
    await fresh.c.query(
      `UPDATE deposit_applications
          SET status='REVERSED', reversed_by_id=$2, reversal_reason=$3,
              reversed_at=now(), version=version+1
        WHERE id=$1`,
      [validApplication, user, validDappReversalReason],
    );
  });
  check('[DAPP: complete reversal transaction succeeds]', validDappReversal === null);
  check(
    '[DAPP: AllocationRelease cannot be rewritten after reversal]',
    (await errCode(
      fresh.c,
      `UPDATE allocation_releases SET amount=99 WHERE id=$1`,
      [validDappReleaseId],
    )) === 'P0001',
  );
  check(
    '[DAPP: Charge can be reversed after Application reversal]',
    (await errCode(fresh.c, `UPDATE charges SET status='REVERSED' WHERE id=$1`, [
      internalCharge,
    ])) === null,
  );
  check('[DAPP: allocation financial identity immutable]',
    (await errCode(fresh.c, `UPDATE payment_allocations SET amount=99 WHERE id=$1`, [internalAllocation])) === 'P0001');
  check('[DAPP: application financial identity immutable]',
    (await errCode(fresh.c, `UPDATE deposit_applications SET amount=99 WHERE id=$1`, [validApplication])) === 'P0001');
  check(
    '[deposit reversal: RECEIVED succeeds after DAPP and child events are reversed]',
    (await errCode(
      fresh.c,
      `INSERT INTO ledger_reversals
         (id,organization_id,resident_id,source_type,source_id,side,amount,reason,actor_user_id,idempotency_key)
       VALUES ($1,$2,$3,'DEPOSIT',$4,'DEBIT',10000,'all dependent events reversed',$5,$6)`,
      [uuid(), org, res, depRecv, user, uuid()],
    )) === null,
  );

  const mismatchPayment = uuid();
  await fresh.c.query(
    `INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at)
     VALUES ($1,$2,$3,100,'DEPOSIT_APPLICATION','2026-11-02',NULL,now())`,
    [mismatchPayment, org, res],
  );
  const mismatchAllocation = uuid();
  await fresh.c.query(
    `INSERT INTO payment_allocations (id, organization_id, resident_id, payment_id, charge_id, amount)
     VALUES ($1,$2,$3,$4,$5,100)`,
    [mismatchAllocation, org, res, mismatchPayment, otherInternalCharge],
  );
  check('[linkage: DepositApplication rejects a mismatched Charge]',
    (await errCode(fresh.c,
      `INSERT INTO deposit_applications (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,amount,reason,actor_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,100,'x',$8)`,
      [uuid(), org, res, depRecv, charge, mismatchPayment, mismatchAllocation, user])) === '23514');

  const creditCharge = uuid();
  await fresh.c.query(
    `INSERT INTO charges
       (id, organization_id, resident_id, type, entry_side, amount, period_start, period_end, due_date, description, updated_at)
     VALUES ($1,$2,$3,'ADJUSTMENT','CREDIT',50,'2026-11-01','2026-12-01','2026-11-01','credit test',now())`,
    [creditCharge, org, res],
  );

  const dappForCreditCharge = uuid();
  await fresh.c.query(
    `INSERT INTO payments
       (id,organization_id,resident_id,amount,method,received_at,receipt_number,updated_at)
     VALUES ($1,$2,$3,50,'DEPOSIT_APPLICATION','2026-11-02',NULL,now())`,
    [dappForCreditCharge, org, res],
  );
  const allocationForCreditCharge = uuid();
  await fresh.c.query(
    `INSERT INTO payment_allocations
       (id,organization_id,resident_id,payment_id,charge_id,amount)
     VALUES ($1,$2,$3,$4,$5,50)`,
    [allocationForCreditCharge, org, res, dappForCreditCharge, creditCharge],
  );
  check('[DAPP: cannot settle a CREDIT charge]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_applications
         (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,amount,reason,actor_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,50,'invalid credit charge',$8)`,
      [uuid(), org, res, depRecv, creditCharge, dappForCreditCharge, allocationForCreditCharge, user],
    )) === '23514');

  const dappForChildDeposit = uuid();
  await fresh.c.query(
    `INSERT INTO payments
       (id,organization_id,resident_id,amount,method,received_at,receipt_number,updated_at)
     VALUES ($1,$2,$3,50,'DEPOSIT_APPLICATION','2026-11-02',NULL,now())`,
    [dappForChildDeposit, org, res],
  );
  const allocationForChildDeposit = uuid();
  await fresh.c.query(
    `INSERT INTO payment_allocations
       (id,organization_id,resident_id,payment_id,charge_id,amount)
     VALUES ($1,$2,$3,$4,$5,50)`,
    [allocationForChildDeposit, org, res, dappForChildDeposit, charge],
  );
  check('[DAPP: cannot consume a REFUNDED child deposit event]',
    (await errCode(
      fresh.c,
      `INSERT INTO deposit_applications
         (id,organization_id,resident_id,deposit_transaction_id,charge_id,payment_id,allocation_id,amount,reason,actor_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,50,'invalid child deposit',$8)`,
      [uuid(), org, res, childRefund, charge, dappForChildDeposit, allocationForChildDeposit, user],
    )) === '23514');

  const refundRow = uuid();
  await fresh.c.query(
    `INSERT INTO payment_refunds (id, organization_id, resident_id, payment_id, amount, reason, actor_user_id)
     VALUES ($1,$2,$3,$4,10,'immutable refund',$5)`,
    [refundRow, org, res, pay, user],
  );
  check('[immutability: payment refund update]',
    (await errCode(fresh.c, `UPDATE payment_refunds SET reason='tampered' WHERE id=$1`, [refundRow])) === 'P0001');

  const reversalRow = uuid();
  await fresh.c.query(
    `INSERT INTO ledger_reversals (id, organization_id, resident_id, source_type, source_id, side, amount, reason, actor_user_id, idempotency_key)
     VALUES ($1,$2,$3,'PAYMENT',$4,'DEBIT',10,'immutable reversal',$5,$6)`,
    [reversalRow, org, res, pay, user, uuid()],
  );
  check('[immutability: ledger reversal update]',
    (await errCode(fresh.c, `UPDATE ledger_reversals SET reason='tampered' WHERE id=$1`, [reversalRow])) === 'P0001');

  const exp = uuid();
  await fresh.c.query(
    `INSERT INTO expenses (id, organization_id, category, status, amount, spent_at, payment_method, actor_user_id, updated_at)
     VALUES ($1,$2,'Util','POSTED',500,'2026-11-03','CASH',$3,now())`,
    [exp, org, user],
  );
  check('[immutability: expense financial identity update]',
    (await errCode(fresh.c, `UPDATE expenses SET amount=501 WHERE id=$1`, [exp])) === 'P0001');
  const expenseReverseTransition = await errCode(
    fresh.c,
    `UPDATE expenses
        SET status='REVERSED', reversed_by_id=$2, reversal_reason='approved test reversal',
            reversed_at=now(), version=version+1, updated_at=now()
      WHERE id=$1`,
    [exp, user],
  );
  check('[immutability: expense reversal metadata remains mutable]', expenseReverseTransition === null);
  check('[immutability: expense delete]', (await errCode(fresh.c, `DELETE FROM expenses WHERE id=$1`, [exp])) === 'P0001');

  const { spawnSync } = require('child_process');
  const out = path.join(require('os').tmpdir(), `m3c_parity_${fresh.name}.sql`);
  const r = spawnSync('npx', ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', out],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl(fresh.name) }, shell: process.platform === 'win32' });
  let diff = '';
  try { diff = fs.readFileSync(out, 'utf8'); } catch {}
  try { fs.unlinkSync(out); } catch {}
  check('[parity: migrate diff exit 0]', r.status === 0, 'status=' + r.status);
  check('[parity: migrate diff empty]', diff.replace(/^\s*-- This is an empty migration\.\s*$/m, '').trim() === '');

  const baselineOut = path.join(require('os').tmpdir(), `m3c_baseline_parity_${baseline.name}.sql`);
  const baselineParity = spawnSync('npx', ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', baselineOut],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl(baseline.name) }, shell: process.platform === 'win32' });
  let baselineDiff = '';
  try { baselineDiff = fs.readFileSync(baselineOut, 'utf8'); } catch {}
  try { fs.unlinkSync(baselineOut); } catch {}
  check('[baseline parity: migrate diff exit 0]', baselineParity.status === 0, 'status=' + baselineParity.status);
  check('[baseline parity: migrate diff empty]', baselineDiff.replace(/^\s*-- This is an empty migration\.\s*$/m, '').trim() === '');

  await fresh.c.end();
  await baseline.c.end();
  await legacyChild.c.end();
  await admin.query(`DROP DATABASE IF EXISTS "${fresh.name}" WITH (FORCE)`).catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${baseline.name}" WITH (FORCE)`).catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${legacyChild.name}" WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});
  console.log('\n' + results.join('\n'));
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} M3c migration checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });