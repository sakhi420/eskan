import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { LockService } from '../../src/common/concurrency/lock.service';
import { PostingService } from '../../src/common/finance/posting.service';
import { DepositsService } from '../../src/deposits/deposits.service';

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
async function seed(db: Client): Promise<Fixture> {
  const org = randomUUID(),
    user = randomUUID(),
    resident = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
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
async function seedCharge(db: Client, org: string, res: string, amount: number): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER',$4,'2026-11-01','2026-12-01','2026-11-01',now())`,
    [id, org, res, amount],
  );
  return id;
}
async function seedContractClosed(db: Client, org: string, res: string): Promise<void> {
  const hostel = randomUUID();
  await db.query(
    `INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`,
    [hostel, org],
  );
  await db.query(
    `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT','CLOSED','2026-11-01',1000,now())`,
    [randomUUID(), org, hostel, res],
  );
}
const money = (amount: number) => ({ amount, currency: 'AFN' });

describe('M3c concurrency (real PostgreSQL + barrier)', () => {
  let admin: Client, db: Client, dbName: string, prisma: PrismaService, deposits: DepositsService;

  beforeAll(async () => {
    assertLocalTestHost();
    jest.setTimeout(60000);
    dbName = `eskan_m3cc_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    deposits = new DepositsService(
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

  it('concurrent refunds cannot exceed the held balance', async () => {
    const f = await seed(db);
    const recv: any = await deposits.receive(
      f.org,
      f.user,
      f.resident,
      { money: money(9000), receivedAt: '2026-11-02' } as any,
      randomUUID(),
      'trace',
    );
    const gate = barrier(2);
    const fire = () =>
      gate().then(() =>
        deposits.refund(
          f.org,
          f.user,
          recv.id,
          { money: money(6000), reason: 'x' } as any,
          randomUUID(),
          'trace',
        ),
      );
    const results = await Promise.allSettled([fire(), fire()]);
    expect(results.filter((x) => x.status === 'fulfilled').length).toBe(1);
    const sum = await db.query(
      `SELECT coalesce(sum(amount),0)::int s FROM deposit_transactions WHERE organization_id=$1 AND type='REFUNDED' AND status='POSTED'`,
      [f.org],
    );
    expect(sum.rows[0].s).toBe(6000);
  });

  it('concurrent forfeits cannot exceed the held balance', async () => {
    const f = await seed(db);
    const recv: any = await deposits.receive(
      f.org,
      f.user,
      f.resident,
      { money: money(8000), receivedAt: '2026-11-02' } as any,
      randomUUID(),
      'trace',
    );
    const gate = barrier(2);
    const fire = () =>
      gate().then(() =>
        deposits.forfeit(
          f.org,
          f.user,
          recv.id,
          { money: money(5000), reason: 'x' } as any,
          randomUUID(),
          'trace',
        ),
      );
    const results = await Promise.allSettled([fire(), fire()]);
    expect(results.filter((x) => x.status === 'fulfilled').length).toBe(1);
    const sum = await db.query(
      `SELECT coalesce(sum(amount),0)::int s FROM deposit_transactions WHERE organization_id=$1 AND type='FORFEITED' AND status='POSTED'`,
      [f.org],
    );
    expect(sum.rows[0].s).toBe(5000);
  });

  it('concurrent applications on the same deposit cannot over-apply', async () => {
    const f = await seed(db);
    await seedContractClosed(db, f.org, f.resident);
    const recv: any = await deposits.receive(
      f.org,
      f.user,
      f.resident,
      { money: money(10000), receivedAt: '2026-11-02' } as any,
      randomUUID(),
      'trace',
    );
    const ch = await seedCharge(db, f.org, f.resident, 20000);
    const gate = barrier(2);
    const fire = () =>
      gate().then(() =>
        deposits.apply(
          f.org,
          f.user,
          f.resident,
          {
            depositTransactionId: recv.id,
            reason: 'x',
            charges: [{ chargeId: ch, money: money(6000) }],
          } as any,
          randomUUID(),
          'trace',
        ),
      );
    const results = await Promise.allSettled([fire(), fire()]);
    expect(results.filter((x) => x.status === 'fulfilled').length).toBe(1);
    const sum = await db.query(
      `SELECT coalesce(sum(amount),0)::int s FROM deposit_applications WHERE organization_id=$1`,
      [f.org],
    );
    expect(sum.rows[0].s).toBe(6000);
  });

  it('refund concurrent with forfeit respects the shared held balance', async () => {
    const f = await seed(db);
    const recv: any = await deposits.receive(
      f.org,
      f.user,
      f.resident,
      { money: money(9000), receivedAt: '2026-11-02' } as any,
      randomUUID(),
      'trace',
    );
    const gate = barrier(2);
    const refund = () =>
      gate().then(() =>
        deposits.refund(
          f.org,
          f.user,
          recv.id,
          { money: money(7000), reason: 'x' } as any,
          randomUUID(),
          'trace',
        ),
      );
    const forfeit = () =>
      gate().then(() =>
        deposits.forfeit(
          f.org,
          f.user,
          recv.id,
          { money: money(7000), reason: 'x' } as any,
          randomUUID(),
          'trace',
        ),
      );
    const results = await Promise.allSettled([refund(), forfeit()]);
    expect(results.filter((x) => x.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    const sum = await db.query(
      `SELECT coalesce(sum(amount),0)::int s FROM deposit_transactions WHERE organization_id=$1 AND type IN ('REFUNDED','FORFEITED') AND status='POSTED'`,
      [f.org],
    );
    expect(sum.rows[0].s).toBeLessThanOrEqual(9000);
    expect(sum.rows[0].s).toBeGreaterThan(0);
  });
});
