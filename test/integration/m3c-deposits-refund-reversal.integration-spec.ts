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
interface Fixture { org: string; user: string; resident: string; }
async function seedOrg(db: Client): Promise<Fixture> {
  const org = randomUUID(), user = randomUUID(), resident = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await db.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`, [user, `u-${randomUUID().slice(0, 8)}@e.com`]);
  await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
  return { org, user, resident };
}
async function seedCharge(db: Client, org: string, residentId: string, amount: number): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER',$4,'2026-11-01','2026-12-01','2026-11-01',now())`, [id, org, residentId, amount]);
  return id;
}
async function seedContract(db: Client, org: string, residentId: string, status: string): Promise<string> {
  const id = randomUUID();
  const hostel = randomUUID();
  await db.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`, [hostel, org]);
  await db.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'2026-11-01',1000,now())`, [id, org, hostel, residentId, `CNT-${randomUUID().slice(0, 8)}`, status]);
  return id;
}

const money = (amount: number) => ({ amount, currency: 'AFN' });

describe('M3c Deposit / Refund / Expense / Reversal (real PostgreSQL + real services)', () => {
  let admin: Client, db: Client, dbName: string, prisma: PrismaService;
  let deposits: DepositsService, expenses: ExpensesService, payments: PaymentsService, charges: ChargesService;
  const idem = (): IdempotencyService => new IdempotencyService(prisma);

  beforeAll(async () => {
    assertLocalTestHost();
    jest.setTimeout(120000);
    dbName = `eskan_m3c_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    const locks = new LockService();
    const posting = new PostingService();
    deposits = new DepositsService(prisma, new IdempotencyService(prisma), posting, locks);
    expenses = new ExpensesService(prisma, new IdempotencyService(prisma), posting, locks);
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

  describe('Deposit ledger', () => {
    it('receives a deposit and computes the held balance', async () => {
      const f = await seedOrg(db);
      const r: any = await deposits.receive(f.org, f.user, f.resident, { money: money(10000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      expect(r.type).toBe('RECEIVED');
      expect(r.money.amount).toBe(10000);
      const rows = await db.query(`SELECT type, status FROM deposit_transactions WHERE organization_id=$1`, [f.org]);
      expect(rows.rowCount).toBe(1);
    });

    it('refunds part of the held deposit', async () => {
      const f = await seedOrg(db);
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(10000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const r: any = await deposits.refund(f.org, f.user, recv.id, { money: money(4000), reason: 'partial' } as any, randomUUID(), 'trace');
      expect(r.type).toBe('REFUNDED');
      expect(r.money.amount).toBe(4000);
    });

    it('rejects refund over the held balance', async () => {
      const f = await seedOrg(db);
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(5000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      await expect(deposits.refund(f.org, f.user, recv.id, { money: money(6000), reason: 'x' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_DEPOSIT_BALANCE' });
    });

    it('forfeits part of the deposit and tracks it separately', async () => {
      const f = await seedOrg(db);
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(10000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const r: any = await deposits.forfeit(f.org, f.user, recv.id, { money: money(3000), reason: 'damage' } as any, randomUUID(), 'trace');
      expect(r.type).toBe('FORFEITED');
    });

    it('rejects forfeit over the held balance', async () => {
      const f = await seedOrg(db);
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(2000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      await expect(deposits.forfeit(f.org, f.user, recv.id, { money: money(3000), reason: 'x' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'DEPOSIT_BALANCE_INSUFFICIENT' });
    });

    it('reverses a received deposit and removes it from the ledger', async () => {
      const f = await seedOrg(db);
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(9000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const r: any = await deposits.reverse(f.org, f.user, recv.id, { reason: 'mistake' } as any, randomUUID(), 'trace');
      expect(r.status).toBe('REVERSED');
      const rev = await db.query(`SELECT count(*)::int n FROM ledger_reversals WHERE source_type='DEPOSIT' AND source_id=$1`, [recv.id]);
      expect(rev.rows[0].n).toBe(1);
    });

    it('rejects deposit application before final checkout (active contract)', async () => {
      const f = await seedOrg(db);
      await seedContract(db, f.org, f.resident, 'ACTIVE');
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(10000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const ch = await seedCharge(db, f.org, f.resident, 5000);
      await expect(deposits.apply(f.org, f.user, f.resident, { depositTransactionId: recv.id, reason: 'settle', charges: [{ chargeId: ch, money: money(5000) }] } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'CHECKOUT_REQUIRED' });
    });

    it('applies deposit at checkout via non-cash DEPOSIT_APPLICATION payment', async () => {
      const f = await seedOrg(db);
      await seedContract(db, f.org, f.resident, 'CLOSED');
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(10000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const ch = await seedCharge(db, f.org, f.resident, 5000);
      const r: any = await deposits.apply(f.org, f.user, f.resident, { depositTransactionId: recv.id, reason: 'settle', charges: [{ chargeId: ch, money: money(5000) }] } as any, randomUUID(), 'trace');
      expect(r.applications).toHaveLength(1);
      expect(r.totalApplied).toBe('5000');
      const pay = await db.query(`SELECT method, receipt_number FROM payments WHERE organization_id=$1 AND method='DEPOSIT_APPLICATION'`, [f.org]);
      expect(pay.rowCount).toBe(1);
      expect(pay.rows[0].receipt_number).toBeNull();
      const counters = await db.query(`SELECT count(*)::int n FROM receipt_counters WHERE organization_id=$1`, [f.org]);
      expect(counters.rows[0].n).toBe(0);
      const alloc = await db.query(`SELECT count(*)::int n FROM payment_allocations WHERE organization_id=$1`, [f.org]);
      expect(alloc.rows[0].n).toBe(1);
    });

    it('rejects application exceeding the deposit balance', async () => {
      const f = await seedOrg(db);
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(3000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const ch = await seedCharge(db, f.org, f.resident, 9000);
      await expect(deposits.apply(f.org, f.user, f.resident, { depositTransactionId: recv.id, reason: 'settle', charges: [{ chargeId: ch, money: money(9000) }] } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'DEPOSIT_BALANCE_INSUFFICIENT' });
    });

    it('rejects application of a charge belonging to another resident', async () => {
      const f = await seedOrg(db);
      const other = randomUUID();
      await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'Other',now())`, [other, f.org]);
      const recv: any = await deposits.receive(f.org, f.user, f.resident, { money: money(10000), receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const chOther = await seedCharge(db, f.org, other, 5000);
      await expect(deposits.apply(f.org, f.user, f.resident, { depositTransactionId: recv.id, reason: 'settle', charges: [{ chargeId: chOther, money: money(5000) }] } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'RESIDENT_MISMATCH' });
    });

    it('replays the same deposit receive idempotently', async () => {
      const f = await seedOrg(db);
      const key = randomUUID();
      const a: any = await deposits.receive(f.org, f.user, f.resident, { money: money(7000), receivedAt: '2026-11-02' } as any, key, 'trace');
      const b: any = await deposits.receive(f.org, f.user, f.resident, { money: money(7000), receivedAt: '2026-11-02' } as any, key, 'trace');
      expect(a.id).toBe(b.id);
      const n = await db.query(`SELECT count(*)::int n FROM deposit_transactions WHERE organization_id=$1`, [f.org]);
      expect(n.rows[0].n).toBe(1);
    });
  });
  describe('Expense', () => {
    it('records a paid expense', async () => {
      const f = await seedOrg(db);
      const r: any = await expenses.create(f.org, f.user, { category: 'Utility', money: money(2000), spentAt: '2026-11-03', paymentMethod: 'CASH' } as any, randomUUID(), 'trace');
      expect(r.status).toBe('POSTED');
      expect(r.money.amount).toBe(2000);
    });

    it('rejects DEPOSIT_APPLICATION as an expense payment method', async () => {
      const f = await seedOrg(db);
      await expect(expenses.create(f.org, f.user, { category: 'X', money: money(100), spentAt: '2026-11-03', paymentMethod: 'DEPOSIT_APPLICATION' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('reverses an expense with a ledger reversal', async () => {
      const f = await seedOrg(db);
      const r: any = await expenses.create(f.org, f.user, { category: 'Utility', money: money(2000), spentAt: '2026-11-03', paymentMethod: 'CASH' } as any, randomUUID(), 'trace');
      const rev: any = await expenses.reverse(f.org, f.user, r.id, { reason: 'mistake' } as any, randomUUID(), 'trace');
      expect(rev.status).toBe('REVERSED');
      const n = await db.query(`SELECT count(*)::int n FROM ledger_reversals WHERE source_type='EXPENSE' AND source_id=$1`, [r.id]);
      expect(n.rows[0].n).toBe(1);
    });

    it('rejects double reversal of an expense', async () => {
      const f = await seedOrg(db);
      const r: any = await expenses.create(f.org, f.user, { category: 'Utility', money: money(2000), spentAt: '2026-11-03', paymentMethod: 'CASH' } as any, randomUUID(), 'trace');
      await expenses.reverse(f.org, f.user, r.id, { reason: 'a' } as any, randomUUID(), 'trace');
      await expect(expenses.reverse(f.org, f.user, r.id, { reason: 'b' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'EXPENSE_ALREADY_REVERSED' });
    });
  });

  describe('Payment refund / void / charge reversal', () => {
    it('refunds the unallocated amount of a payment', async () => {
      const f = await seedOrg(db);
      const p: any = await payments.createPayment(f.org, f.user, { residentId: f.resident, money: money(10000), method: 'CASH', receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const r: any = await payments.refundPayment(f.org, f.user, p.id, { money: money(4000), reason: 'refund' } as any, randomUUID(), 'trace');
      expect(r.money.amount).toBe(4000);
    });

    it('rejects refund over the unallocated amount', async () => {
      const f = await seedOrg(db);
      const p: any = await payments.createPayment(f.org, f.user, { residentId: f.resident, money: money(3000), method: 'CASH', receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      await expect(payments.refundPayment(f.org, f.user, p.id, { money: money(4000), reason: 'x' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'PAYMENT_REFUND_EXCEEDS_UNALLOCATED' });
    });

    it('voids a payment, releasing its allocations append-only', async () => {
      const f = await seedOrg(db);
      const ch = await seedCharge(db, f.org, f.resident, 10000);
      const p: any = await payments.createPayment(f.org, f.user, { residentId: f.resident, money: money(10000), method: 'CASH', receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      const alloc: any = await payments.createAllocation(f.org, f.user, p.id, { chargeId: ch, money: money(10000) } as any, randomUUID(), 'trace');
      const r: any = await payments.reversePayment(f.org, f.user, p.id, { reason: 'wrong' } as any, randomUUID(), 'trace');
      expect(r.payment.status).toBe('REVERSED');
      expect(r.releases.length).toBe(1);
      expect(r.reversal.sourceType).toBe('PAYMENT');
      const rel = await db.query(`SELECT count(*)::int n FROM allocation_releases WHERE allocation_id=$1`, [alloc.id]);
      expect(rel.rows[0].n).toBe(1);
    });

    it('rejects voiding a payment that already has a refund', async () => {
      const f = await seedOrg(db);
      const p: any = await payments.createPayment(f.org, f.user, { residentId: f.resident, money: money(10000), method: 'CASH', receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      await payments.refundPayment(f.org, f.user, p.id, { money: money(1000), reason: 'x' } as any, randomUUID(), 'trace');
      await expect(payments.reversePayment(f.org, f.user, p.id, { reason: 'wrong' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });

    it('reverses a charge, releasing its allocations first', async () => {
      const f = await seedOrg(db);
      const ch = await seedCharge(db, f.org, f.resident, 8000);
      const p: any = await payments.createPayment(f.org, f.user, { residentId: f.resident, money: money(8000), method: 'CASH', receivedAt: '2026-11-02' } as any, randomUUID(), 'trace');
      await payments.createAllocation(f.org, f.user, p.id, { chargeId: ch, money: money(5000) } as any, randomUUID(), 'trace');
      const r: any = await charges.reverseCharge(f.org, f.user, ch, { reason: 'wrong' } as any, randomUUID(), 'trace');
      expect(r.status).toBe('REVERSED');
      const rev = await db.query(`SELECT count(*)::int n FROM ledger_reversals WHERE source_type='CHARGE' AND source_id=$1`, [ch]);
      expect(rev.rows[0].n).toBe(1);
    });
  });
});