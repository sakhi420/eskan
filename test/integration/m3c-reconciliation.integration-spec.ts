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

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const withDatabase = (n: string) => {
  const u = new URL(BASE_URL);
  u.pathname = `/${n}`;
  return u.toString();
};
function assertLocalTestHost(): void {
  let host = '',
    db = '';
  try {
    const u = new URL(BASE_URL);
    host = u.hostname;
    db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {}
  if (
    !['localhost', '127.0.0.1', '::1'].includes(host) ||
    !['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db)
  ) {
    if (process.env.ESKAN_TEST_DB_ALLOW !== '1') throw new Error('REFUSED: not local');
  }
}
const money = (amount: number) => ({ amount, currency: 'AFN' });

describe('M3c reconciliation (SQL oracle)', () => {
  let admin: Client,
    db: Client,
    dbName: string,
    prisma: PrismaService,
    deposits: DepositsService,
    expenses: ExpensesService;

  beforeAll(async () => {
    assertLocalTestHost();
    jest.setTimeout(120000);
    dbName = `eskan_m3cr_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    const posting = new PostingService(),
      locks = new LockService();
    deposits = new DepositsService(prisma, new IdempotencyService(prisma), posting, locks);
    expenses = new ExpensesService(prisma, new IdempotencyService(prisma), posting, locks);
    db = new Client({ connectionString: url });
    await db.connect();
  }, 120000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => {});
    await db?.end().catch(() => {});
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  }, 60000);

  it('reconciles Deposit Held + non-cash payments (SQL oracle)', async () => {
    const org = randomUUID(),
      user = randomUUID(),
      resident = randomUUID();
    await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [
      org,
    ]);
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`,
      [user, `u-${randomUUID()}@e.com`],
    );
    await db.query(
      `INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`,
      [resident, org],
    );
    const chargeId = randomUUID();
    await db.query(
      `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER',6000,'2026-11-01','2026-12-01','2026-11-01',now())`,
      [chargeId, org, resident],
    );
    const hostel = randomUUID();
    await db.query(
      `INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`,
      [hostel, org],
    );
    await db.query(
      `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT','CLOSED','2026-11-01',1000,now())`,
      [randomUUID(), org, hostel, resident],
    );

    const recv: any = await deposits.receive(
      org,
      user,
      resident,
      { money: money(100000), receivedAt: '2026-11-02' } as any,
      randomUUID(),
      'trace',
    );
    await deposits.refund(
      org,
      user,
      recv.id,
      { money: money(20000), reason: 'r' } as any,
      randomUUID(),
      'trace',
    );
    await deposits.forfeit(
      org,
      user,
      recv.id,
      { money: money(10000), reason: 'f' } as any,
      randomUUID(),
      'trace',
    );
    await deposits.apply(
      org,
      user,
      resident,
      {
        depositTransactionId: recv.id,
        reason: 'a',
        charges: [{ chargeId, money: money(5000) }],
      } as any,
      randomUUID(),
      'trace',
    );
    await expenses.create(
      org,
      user,
      { category: 'Util', money: money(3000), spentAt: '2026-11-05', paymentMethod: 'CASH' } as any,
      randomUUID(),
      'trace',
    );

    const q = await db.query(
      `
      SELECT
        (SELECT coalesce(sum(amount),0)::int FROM deposit_transactions WHERE organization_id=$1 AND resident_id=$2 AND type='RECEIVED' AND status='POSTED') AS received,
        (SELECT coalesce(sum(amount),0)::int FROM deposit_transactions WHERE organization_id=$1 AND resident_id=$2 AND type='REFUNDED' AND status='POSTED') AS refunded,
        (SELECT coalesce(sum(amount),0)::int FROM deposit_transactions WHERE organization_id=$1 AND resident_id=$2 AND type='FORFEITED' AND status='POSTED') AS forfeited,
        (SELECT coalesce(sum(amount),0)::int FROM deposit_applications WHERE organization_id=$1 AND resident_id=$2 AND status='POSTED') AS applied
    `,
      [org, resident],
    );
    const row = q.rows[0];
    expect(row.received).toBe(100000);
    expect(row.refunded).toBe(20000);
    expect(row.forfeited).toBe(10000);
    expect(row.applied).toBe(5000);
    expect(row.received - row.refunded - row.forfeited - row.applied).toBe(65000);

    const pay = await db.query(
      `SELECT method, receipt_number IS NULL AS no_receipt FROM payments WHERE organization_id=$1 AND resident_id=$2 AND method='DEPOSIT_APPLICATION'`,
      [org, resident],
    );
    expect(pay.rowCount).toBe(1);
    expect(pay.rows[0].no_receipt).toBe(true);
    const counters = await db.query(
      `SELECT count(*)::int n FROM receipt_counters WHERE organization_id=$1`,
      [org],
    );
    expect(counters.rows[0].n).toBe(0);
    const paidExpenses = await db.query(
      `SELECT coalesce(sum(amount),0)::int s FROM expenses WHERE organization_id=$1 AND status='POSTED'`,
      [org],
    );
    expect(paidExpenses.rows[0].s).toBe(3000);
  });
});
