import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { LockService } from '../../src/common/concurrency/lock.service';
import { PostingService } from '../../src/common/finance/posting.service';
import { DepositsService } from '../../src/deposits/deposits.service';
import { ExpensesService } from '../../src/expenses/expenses.service';
import { PaymentsService } from '../../src/payments/payments.service';
import { ChargesService } from '../../src/charges/charges.service';

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const withDatabase = (n: string) => { const u = new URL(BASE_URL); u.pathname = `/${n}`; return u.toString(); };
function assertLocalTestHost(): void {
  let host = '', db = '';
  try { const u = new URL(BASE_URL); host = u.hostname; db = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch {}
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || !['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db)) {
    if (process.env.ESKAN_TEST_DB_ALLOW !== '1') throw new Error('REFUSED: not local');
  }
}
const money = (amount: number) => ({ amount, currency: 'AFN' });

interface Fixture { org: string; user: string; resident: string; }
async function seedCheckoutOrg(db: Client): Promise<Fixture> {
  const org = randomUUID(), user = randomUUID(), resident = randomUUID(), hostel = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await db.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`, [user, `u-${randomUUID().slice(0, 8)}@e.com`]);
  await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
  await db.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`, [hostel, org]);
  await db.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT','CLOSED','2026-11-01',1000,now())`, [randomUUID(), org, hostel, resident]);
  return { org, user, resident };
}
async function seedCharge(db: Client, org: string, res: string, amount: number): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER',$4,'2026-11-01','2026-12-01','2026-11-01',now())`, [id, org, res, amount]);
  return id;
}

describe('M3c remediation (real PostgreSQL + real services)', () => {
  let admin: Client, db: Client, dbName: string, prisma: PrismaService;
  let deposits: DepositsService, expenses: ExpensesService, payments: PaymentsService, charges: ChargesService;

  beforeAll(async () => {
    assertLocalTestHost();
    jest.setTimeout(120000);
    dbName = `eskan_m3crem_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    const posting = new PostingService(), locks = new LockService(), idem = () => new IdempotencyService(prisma);
    deposits = new DepositsService(prisma, idem(), posting, locks);
    expenses = new ExpensesService(prisma, idem(), posting, locks);
    payments = new PaymentsService(prisma, idem(), posting, locks);
    charges = new ChargesService(prisma, idem(), posting, locks);
    db = new Client({ connectionString: url });
    await db.connect();
  }, 120000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => {});
    await db?.end().catch(() => {});
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {}); await admin.end().catch(() => {}); }
  }, 60000);

  it('P0-1: refund shrinks the allocatable balance of a payment', async () => {
    const f = await seedCheckoutOrg(db);
    const p: any = await payments.createPayment(f.org, f.user, { residentId: f.resident, money: money(10000), method: 'CASH', receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
    await payments.refundPayment(f.org, f.user, p.id, { money: money(4000), reason: 'r' } as any, randomUUID(), 'trace');
    const ch = await seedCharge(db, f.org, f.resident, 20000);
    await expect(payments.createAllocation(f.org, f.user, p.id, { chargeId: ch, money: money(10000) } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'ALLOCATION_EXCEEDS_PAYMENT' });
    await payments.createAllocation(f.org, f.user, p.id, { chargeId: ch, money: money(6000) } as any, randomUUID(), 'trace');
    const unapplied = await db.query(`SELECT ((SELECT coalesce(sum(p.amount),0) FROM payments p WHERE p.id=$1 AND p.organization_id=$2) - (SELECT coalesce(sum(pa.amount),0) FROM payment_allocations pa WHERE pa.payment_id=$1 AND pa.organization_id=$2) + (SELECT coalesce(sum(ar.amount),0) FROM allocation_releases ar JOIN payment_allocations pa ON pa.id=ar.allocation_id WHERE pa.payment_id=$1) - (SELECT coalesce(sum(pr.amount),0) FROM payment_refunds pr WHERE pr.payment_id=$1 AND pr.organization_id=$2))::int AS usable`, [p.id, f.org]);
    expect(unapplied.rows[0].usable).toBe(0);
  });

  it('P0-2: normal payment path refuses DEPOSIT_APPLICATION', async () => {
    const f = await seedCheckoutOrg(db);
    await expect(payments.createPayment(f.org, f.user, { residentId: f.resident, money: money(1000), method: 'DEPOSIT_APPLICATION', receivedAt: '2026-11-02' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
  });

  it('P0-2: DB forbids a DEPOSIT_APPLICATION payment carrying a receipt number', async () => {
    const f = await seedCheckoutOrg(db);
    let code = null;
    try {
      await db.query(`INSERT INTO payments (id, organization_id, resident_id, amount, method, received_at, receipt_number, updated_at) VALUES ($1,$2,$3,100,'DEPOSIT_APPLICATION','2026-11-02','RC-1',now())`, [randomUUID(), f.org, f.resident]);
    } catch (e: any) { code = e.code; }
    expect(code).toBe('23514');
  });

  it('P0-3: DAPP reversal restores Deposit Held and reopens the charge once', async () => {
    const f = await seedCheckoutOrg(db);
    const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(10000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
    const ch = await seedCharge(db, f.org, f.resident, 4000);
    const r: any = await deposits.apply(f.org, f.user, f.resident, { depositTransactionId: recv.id, reason: 'settle', charges: [{ chargeId: ch, money: money(4000) }] } as any, randomUUID(), 'trace');
    const app = r.applications[0];
    expect(app.paymentId).toBeTruthy();
    expect(app.allocationId).toBeTruthy();

    // DAPP must reject every generic mutation path; only reverseApplication owns it.
    await expect(payments.refundPayment(f.org, f.user, app.paymentId, { money: money(100), reason: 'x' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    await expect(payments.reversePayment(f.org, f.user, app.paymentId, { reason: 'x' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    const otherCharge = await seedCharge(db, f.org, f.resident, 4000);
    await expect(payments.createAllocation(
      f.org, f.user, app.paymentId, { chargeId: otherCharge, money: money(1000) } as any, randomUUID(), 'trace',
    )).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    await expect(payments.releaseAllocation(
      f.org, f.user, app.allocationId, { money: money(1000), reason: 'x' } as any, randomUUID(), 'trace',
    )).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });

    const rev: any = await deposits.reverseApplication(f.org, f.user, app.id, { reason: 'wrong' } as any, randomUUID(), 'trace');
    expect(rev.application.status).toBe('REVERSED');

    const held = await db.query(`SELECT (SELECT coalesce(sum(amount),0)::int FROM deposit_transactions WHERE organization_id=$1 AND resident_id=$2 AND type='RECEIVED' AND status='POSTED') - (SELECT coalesce(sum(amount),0)::int FROM deposit_applications WHERE organization_id=$1 AND resident_id=$2 AND status='POSTED') AS held`, [f.org, f.resident]);
    expect(held.rows[0].held).toBe(10000);

    const payState = await db.query(`SELECT status FROM payments WHERE id=$1`, [app.paymentId]);
    expect(payState.rows[0].status).toBe('REVERSED');
    const releases = await db.query(`SELECT count(*)::int n FROM allocation_releases WHERE allocation_id=$1`, [app.allocationId]);
    expect(releases.rows[0].n).toBe(1);
    const paymentAllocations = await db.query(`SELECT count(*)::int n FROM payment_allocations WHERE payment_id=$1`, [app.paymentId]);
    expect(paymentAllocations.rows[0].n).toBe(1);
    const lr = await db.query(`SELECT side FROM ledger_reversals WHERE source_type='PAYMENT' AND source_id=$1`, [app.paymentId]);
    expect(lr.rows[0].side).toBe('DEBIT');
  });

  it('P1-6: rejects Apply when CLOSED and ACTIVE contracts coexist', async () => {
    const f = await seedCheckoutOrg(db);
    const hostel = await db.query(`SELECT id FROM hostels WHERE organization_id=$1 LIMIT 1`, [f.org]);
    await db.query(
      `INSERT INTO stay_contracts
       (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE','2026-11-02',1000,now())`,
      [randomUUID(), f.org, hostel.rows[0].id, f.resident, `ACTIVE-${randomUUID().slice(0, 8)}`],
    );
    const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(5000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
    const charge = await seedCharge(db, f.org, f.resident, 5000);
    await expect(deposits.apply(
      f.org, f.user, f.resident,
      { depositTransactionId: recv.id, reason: 'checkout', charges: [{ chargeId: charge, money: money(1000) }] } as any,
      randomUUID(), 'trace',
    )).rejects.toMatchObject({ code: 'CHECKOUT_REQUIRED' });
  });

  it('P1-1: refund+forfeit+apply are source-scoped and never overcount', async () => {
    const f = await seedCheckoutOrg(db);
    const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(100000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
    await deposits.refund(f.org, f.user, recv.id, { money: money(20000), reason: 'r' } as any, randomUUID(), 'trace');
    await deposits.forfeit(f.org, f.user, recv.id, { money: money(10000), reason: 'f' } as any, randomUUID(), 'trace');
    const ch = await seedCharge(db, f.org, f.resident, 5000);
    const r: any = await deposits.apply(f.org, f.user, f.resident, { depositTransactionId: recv.id, reason: 'a', charges: [{ chargeId: ch, money: money(5000) }] } as any, randomUUID(), 'trace');
    expect(r.remainingDepositBalance).toBe('65000');
  });

  it('P1-3: reversal sides are opposite the original posting side', async () => {
    const f = await seedCheckoutOrg(db);
    const p: any = await payments.createPayment(f.org, f.user, { residentId: f.resident, money: money(5000), method: 'CASH', receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
    await payments.reversePayment(f.org, f.user, p.id, { reason: 'x' } as any, randomUUID(), 'trace');
    const lrPay = await db.query(`SELECT side FROM ledger_reversals WHERE source_type='PAYMENT' AND source_id=$1`, [p.id]);
    expect(lrPay.rows[0].side).toBe('DEBIT');
    const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(5000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
    await deposits.reverse(f.org, f.user, recv.id, { reason: 'x' } as any, randomUUID(), 'trace');
    const lrDep = await db.query(`SELECT side FROM ledger_reversals WHERE source_type='DEPOSIT' AND source_id=$1`, [recv.id]);
    expect(lrDep.rows[0].side).toBe('DEBIT');
    const e: any = await expenses.create(f.org, f.user, { category: 'Util', money: money(500), spentAt: '2026-11-03', paymentMethod: 'CASH' } as any, randomUUID(), 'trace');
    await expenses.reverse(f.org, f.user, e.id, { reason: 'x' } as any, randomUUID(), 'trace');
    const lrExp = await db.query(`SELECT side FROM ledger_reversals WHERE source_type='EXPENSE' AND source_id=$1`, [e.id]);
    expect(lrExp.rows[0].side).toBe('CREDIT');
  });

  it('P1-5: apply replay keeps the committed balance snapshot after later movement', async () => {
    const f = await seedCheckoutOrg(db);
    const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(10000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
    const ch = await seedCharge(db, f.org, f.resident, 3000);
    const key = randomUUID();
    const a: any = await deposits.apply(f.org, f.user, f.resident, { depositTransactionId: recv.id, reason: 'a', charges: [{ chargeId: ch, money: money(3000) }] } as any, key, 'trace');
    await deposits.refund(f.org, f.user, recv.id, { money: money(2000), reason: 'later' } as any, randomUUID(), 'trace');
    const b: any = await deposits.apply(f.org, f.user, f.resident, { depositTransactionId: recv.id, reason: 'a', charges: [{ chargeId: ch, money: money(3000) }] } as any, key, 'trace');
    expect(a.remainingDepositBalance).toBe(b.remainingDepositBalance);
    expect(a.totalApplied).toBe(b.totalApplied);
    expect(a.applications[0].id).toBe(b.applications[0].id);
  });
});