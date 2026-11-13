import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { LockService } from '../../src/common/concurrency/lock.service';
import { PostingService } from '../../src/common/finance/posting.service';
import { PaymentsService } from '../../src/payments/payments.service';

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

function withDatabase(dbName: string): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function assertLocalTestHost(): void {
  let host = '';
  let db = '';
  try {
    const u = new URL(BASE_URL);
    host = u.hostname;
    db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {}
  if (
    !['localhost', '127.0.0.1', '::1'].includes(host) ||
    !['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db)
  ) {
    if (process.env.ESKAN_TEST_DB_ALLOW !== '1')
      throw new Error(`REFUSED: host="${host}" db="${db}" is not local`);
  }
}

/** Controllable arrival barrier: all `n` workers block until every one has arrived. */
function barrier(n: number): () => Promise<void> {
  let count = 0;
  const waiters: Array<() => void> = [];
  return () => {
    count += 1;
    if (count === n) {
      const w = waiters.splice(0);
      w.forEach((res) => res());
      return Promise.resolve();
    }
    return new Promise<void>((res) => waiters.push(res));
  };
}

interface Fixture {
  org: string;
  user: string;
  resident: string;
}

describe('M3b concurrency (real PostgreSQL + barrier)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;
  let payments: PaymentsService;

  beforeAll(async () => {
    assertLocalTestHost();
    jest.setTimeout(60000);
    dbName = `eskan_m3bc_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    payments = new PaymentsService(
      prisma,
      new IdempotencyService(prisma),
      new PostingService(),
      new LockService(),
    );
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

  async function seed(): Promise<Fixture> {
    const org = randomUUID(),
      user = randomUUID(),
      resident = randomUUID();
    await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [
      org,
    ]);
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`,
      [user, `u-${randomUUID().slice(0, 8)}@e.com`],
    );
    await db.query(
      `INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`,
      [resident, org],
    );
    return { org, user, resident };
  }

  async function seedCharge(f: Fixture, amount: number): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at)
       VALUES ($1,$2,$3,'OTHER',$4,'2026-11-01','2026-12-01','2026-11-01',now())`,
      [id, f.org, f.resident, amount],
    );
    return id;
  }

  it('concurrent payments get distinct, monotonic receipt numbers', async () => {
    const f = await seed();
    const dto = {
      residentId: f.resident,
      money: { amount: 5000, currency: 'AFN' },
      method: 'CASH',
      receivedAt: '2026-11-02',
    };
    const gate = barrier(2);
    const fire = () =>
      gate().then(() => payments.createPayment(f.org, f.user, dto as any, randomUUID(), 'trace'));
    const results = await Promise.allSettled([fire(), fire()]);
    const ok = results.map((r) =>
      r.status === 'fulfilled' ? (r.value as any).receiptNumber : null,
    );
    expect(ok).toHaveLength(2);
    expect(ok[0]).not.toBe(ok[1]);
    const rows = await db.query(
      'SELECT receipt_number FROM payments WHERE organization_id=$1 ORDER BY receipt_number',
      [f.org],
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows[0].receipt_number < rows.rows[1].receipt_number).toBe(true);
  });

  it('concurrent same-key payments create exactly one payment/receipt', async () => {
    const f = await seed();
    const dto = {
      residentId: f.resident,
      money: { amount: 5000, currency: 'AFN' },
      method: 'CASH',
      receivedAt: '2026-11-02',
    };
    const key = randomUUID();
    const gate = barrier(2);
    const fire = () =>
      gate().then(() => payments.createPayment(f.org, f.user, dto as any, key, 'trace'));
    const results = await Promise.allSettled([fire(), fire()]);
    const ids = results.map((r) => (r.status === 'fulfilled' ? (r.value as any).id : null));
    const receipts = results.map((r) =>
      r.status === 'fulfilled' ? (r.value as any).receiptNumber : null,
    );
    expect(ids[0]).toBe(ids[1]);
    expect(receipts[0]).toBe(receipts[1]);
    const n = await db.query('SELECT count(*)::int n FROM payments WHERE organization_id=$1', [
      f.org,
    ]);
    expect(n.rows[0].n).toBe(1);
  });

  it('concurrent allocations cannot exceed the unapplied payment balance', async () => {
    const f = await seed();
    const chargeId = await seedCharge(f, 100000);
    const pay: any = await payments.createPayment(
      f.org,
      f.user,
      {
        residentId: f.resident,
        money: { amount: 1000, currency: 'AFN' },
        method: 'CASH',
        receivedAt: '2026-11-02',
      } as any,
      randomUUID(),
      'trace',
    );
    const gate = barrier(2);
    const fire = () =>
      gate().then(() =>
        payments.createAllocation(
          f.org,
          f.user,
          pay.id,
          { chargeId, money: { amount: 700, currency: 'AFN' } } as any,
          randomUUID(),
          'trace',
        ),
      );
    const results = await Promise.allSettled([fire(), fire()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toBe(1);
    expect(rejected[0]?.reason?.code).toBe('ALLOCATION_EXCEEDS_PAYMENT');
    const sum = await db.query(
      'SELECT coalesce(sum(amount),0)::int s FROM payment_allocations WHERE payment_id=$1',
      [pay.id],
    );
    expect(sum.rows[0].s).toBe(700);
  });

  it('concurrent releases cannot exceed the allocation amount', async () => {
    const f = await seed();
    const chargeId = await seedCharge(f, 100000);
    const pay: any = await payments.createPayment(
      f.org,
      f.user,
      {
        residentId: f.resident,
        money: { amount: 5000, currency: 'AFN' },
        method: 'CASH',
        receivedAt: '2026-11-02',
      } as any,
      randomUUID(),
      'trace',
    );
    const alloc: any = await payments.createAllocation(
      f.org,
      f.user,
      pay.id,
      { chargeId, money: { amount: 1000, currency: 'AFN' } } as any,
      randomUUID(),
      'trace',
    );
    const gate = barrier(2);
    const fire = () =>
      gate().then(() =>
        payments.releaseAllocation(
          f.org,
          f.user,
          alloc.id,
          { money: { amount: 600, currency: 'AFN' }, reason: 'race' } as any,
          randomUUID(),
          'trace',
        ),
      );
    const results = await Promise.allSettled([fire(), fire()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilled).toBe(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected[0]?.reason?.code).toBe('BUSINESS_RULE_VIOLATION');
    const sum = await db.query(
      'SELECT coalesce(sum(amount),0)::int s FROM allocation_releases WHERE allocation_id=$1',
      [alloc.id],
    );
    expect(sum.rows[0].s).toBe(600);
  });
});
