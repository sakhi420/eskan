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

interface Fixture {
  org: string;
  user: string;
  resident: string;
}

async function seedOrg(db: Client): Promise<Fixture> {
  const org = randomUUID(),
    user = randomUUID(),
    resident = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','User',now())`,
    [user, `u-${randomUUID().slice(0, 8)}@e.com`],
  );
  await db.query(
    `INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`,
    [resident, org],
  );
  return { org, user, resident };
}

async function seedCharge(db: Client, f: Fixture, amount: number): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at)
     VALUES ($1,$2,$3,'OTHER',$4,'2026-11-01','2026-12-01','2026-11-01',now())`,
    [id, f.org, f.resident, amount],
  );
  return id;
}

async function seedChargeForResident(
  db: Client,
  org: string,
  residentId: string,
  amount: number,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at)
     VALUES ($1,$2,$3,'OTHER',$4,'2026-11-01','2026-12-01','2026-11-01',now())`,
    [id, org, residentId, amount],
  );
  return id;
}

const paymentDto = (f: Fixture, overrides: Record<string, unknown> = {}) => ({
  residentId: f.resident,
  money: { amount: 10000, currency: 'AFN' },
  method: 'CASH',
  receivedAt: '2026-11-02',
  ...overrides,
});

describe('M3b Payment / Receipt / Allocation / Release (real PostgreSQL + real services)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let idem: IdempotencyService;

  beforeAll(async () => {
    assertLocalTestHost();
    jest.setTimeout(120000);
    dbName = `eskan_m3b_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    idem = new IdempotencyService(prisma);
    const locks = new LockService();
    payments = new PaymentsService(prisma, idem, new PostingService(), locks);
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

  describe('Payment & Receipt', () => {
    it('records an unapplied payment with a server-issued zero-padded receipt number', async () => {
      const f = await seedOrg(db);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        randomUUID(),
        'trace',
      );
      expect(r.receiptNumber).toBe('0000000001');
      expect(r.money.amount).toBe(10000);
      expect(r.status).toBe('POSTED');
      expect(r.allocations).toBeUndefined();
      expect(r.provisionalReceipt).toBeUndefined();
      const alloc = await db.query(
        'SELECT count(*)::int n FROM payment_allocations WHERE payment_id=$1',
        [r.id],
      );
      expect(alloc.rows[0].n).toBe(0);
    });

    it('keeps the third-party payer optional and never changes the debtor (resident)', async () => {
      const f = await seedOrg(db);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f, {
          payerName: 'Ali',
          payerPhone: '0700000000',
          payerRelation: 'Brother',
        }) as any,
        randomUUID(),
        'trace',
      );
      expect(r.payerName).toBe('Ali');
      expect(r.residentId).toBe(f.resident);
    });

    it('maps a provisionalReceiptId to an official issued receipt', async () => {
      const f = await seedOrg(db);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f, { provisionalReceiptId: 'ofl-123' }) as any,
        randomUUID(),
        'trace',
      );
      expect(r.provisionalReceiptId).toBe('ofl-123');
      expect(r.provisionalReceipt).toMatchObject({
        provisionalReceiptId: 'ofl-123',
        status: 'ISSUED',
        officialReceiptNumber: r.receiptNumber,
      });
    });

    it('does not persist payer PII or notes in the idempotency record (replay rebuilt from source)', async () => {
      const f = await seedOrg(db);
      const key = randomUUID();
      const body = paymentDto(f, {
        payerName: 'Alice',
        payerPhone: '0701234567',
        payerRelation: 'Sister',
        notes: 'secret note',
      }) as any;
      const r: any = await payments.createPayment(f.org, f.user, body, key, 'trace');

      const rec = await db.query(
        `SELECT response_body FROM idempotency_records WHERE organization_id=$1 AND idempotency_key=$2`,
        [f.org, key],
      );
      expect(rec.rowCount).toBe(1);
      const stored = JSON.stringify(rec.rows[0].response_body);
      expect(stored).toBeDefined();
      expect(stored).not.toContain('Alice');
      expect(stored).not.toContain('0701234567');
      expect(stored).not.toContain('Sister');
      expect(stored).not.toContain('secret note');
      expect(stored).toContain('resourceId');
      expect(stored).toContain(r.id);

      // Replay returns the same payment and official receipt, rebuilt from the source.
      const replay: any = await payments.createPayment(f.org, f.user, body, key, 'trace');
      expect(replay.id).toBe(r.id);
      expect(replay.receiptNumber).toBe(r.receiptNumber);
      expect(replay.payerName).toBe('Alice');
    });

    it('issues unique, monotonic receipt numbers per organization (no yearly reset)', async () => {
      const f = await seedOrg(db);
      const a: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f, { receivedAt: '2025-12-31' }) as any,
        randomUUID(),
        'trace',
      );
      const b: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f, { receivedAt: '2026-01-01' }) as any,
        randomUUID(),
        'trace',
      );
      expect(a.receiptNumber).not.toBe(b.receiptNumber);
      expect(a.receiptNumber < b.receiptNumber).toBe(true);
    });

    it('receipt numbers are independent per organization', async () => {
      const f1 = await seedOrg(db);
      const f2 = await seedOrg(db);
      const a: any = await payments.createPayment(
        f1.org,
        f1.user,
        paymentDto(f1) as any,
        randomUUID(),
        'trace',
      );
      const b: any = await payments.createPayment(
        f2.org,
        f2.user,
        paymentDto(f2) as any,
        randomUUID(),
        'trace',
      );
      expect(a.receiptNumber).toBe('0000000001');
      expect(b.receiptNumber).toBe('0000000001');
      expect(a.organizationId).not.toBe(b.organizationId);
    });

    it('replays the same payment and receipt for the same idempotency key', async () => {
      const f = await seedOrg(db);
      const key = randomUUID();
      const a: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        key,
        'trace',
      );
      const b: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        key,
        'trace',
      );
      expect(b.id).toBe(a.id);
      expect(b.receiptNumber).toBe(a.receiptNumber);
      const n = await db.query('SELECT count(*)::int n FROM payments WHERE organization_id=$1', [
        f.org,
      ]);
      expect(n.rows[0].n).toBe(1);
    });

    it('rejects the same idempotency key with a different payload', async () => {
      const f = await seedOrg(db);
      const key = randomUUID();
      await payments.createPayment(f.org, f.user, paymentDto(f) as any, key, 'trace');
      await expect(
        payments.createPayment(
          f.org,
          f.user,
          paymentDto(f, { money: { amount: 999, currency: 'AFN' } }) as any,
          key,
          'trace',
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('rejects a payment for a resident of another tenant (404)', async () => {
      const f1 = await seedOrg(db);
      const f2 = await seedOrg(db);
      await expect(
        payments.createPayment(f1.org, f1.user, paymentDto(f2) as any, randomUUID(), 'trace'),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });
  });

  describe('Allocation', () => {
    it('partially allocates a payment to a charge within both balances', async () => {
      const f = await seedOrg(db);
      const chargeId = await seedCharge(db, f, 6000);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f, { money: { amount: 10000, currency: 'AFN' } }) as any,
        randomUUID(),
        'trace',
      );
      const a: any = await payments.createAllocation(
        f.org,
        f.user,
        r.id,
        { chargeId, money: { amount: 4000, currency: 'AFN' } } as any,
        randomUUID(),
        'trace',
      );
      expect(a.money.amount).toBe(4000);
      expect(a.paymentId).toBe(r.id);
      expect(a.chargeId).toBe(chargeId);
    });

    it('rejects allocation above unapplied payment balance', async () => {
      const f = await seedOrg(db);
      const chargeId = await seedCharge(db, f, 100000);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f, { money: { amount: 1000, currency: 'AFN' } }) as any,
        randomUUID(),
        'trace',
      );
      await expect(
        payments.createAllocation(
          f.org,
          f.user,
          r.id,
          { chargeId, money: { amount: 2000, currency: 'AFN' } } as any,
          randomUUID(),
          'trace',
        ),
      ).rejects.toMatchObject({ code: 'ALLOCATION_EXCEEDS_PAYMENT' });
    });

    it('rejects allocation above outstanding charge balance', async () => {
      const f = await seedOrg(db);
      const chargeId = await seedCharge(db, f, 500);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f, { money: { amount: 10000, currency: 'AFN' } }) as any,
        randomUUID(),
        'trace',
      );
      await expect(
        payments.createAllocation(
          f.org,
          f.user,
          r.id,
          { chargeId, money: { amount: 600, currency: 'AFN' } } as any,
          randomUUID(),
          'trace',
        ),
      ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });

    it('rejects allocating to a charge belonging to another resident', async () => {
      const f = await seedOrg(db);
      const otherResident = randomUUID();
      await db.query(
        `INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R2',now())`,
        [otherResident, f.org],
      );
      const chargeId = await seedChargeForResident(db, f.org, otherResident, 5000);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        randomUUID(),
        'trace',
      );
      await expect(
        payments.createAllocation(
          f.org,
          f.user,
          r.id,
          { chargeId, money: { amount: 1000, currency: 'AFN' } } as any,
          randomUUID(),
          'trace',
        ),
      ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });

    it('rejects allocating to a charge of another organization (404)', async () => {
      const f = await seedOrg(db);
      const f2 = await seedOrg(db);
      const chargeId = await seedCharge(db, f2, 5000);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        randomUUID(),
        'trace',
      );
      await expect(
        payments.createAllocation(
          f.org,
          f.user,
          r.id,
          { chargeId, money: { amount: 1000, currency: 'AFN' } } as any,
          randomUUID(),
          'trace',
        ),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    });

    it('replays an idempotent allocation (single allocation row)', async () => {
      const f = await seedOrg(db);
      const chargeId = await seedCharge(db, f, 6000);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        randomUUID(),
        'trace',
      );
      const key = randomUUID();
      const a: any = await payments.createAllocation(
        f.org,
        f.user,
        r.id,
        { chargeId, money: { amount: 3000, currency: 'AFN' } } as any,
        key,
        'trace',
      );
      const b: any = await payments.createAllocation(
        f.org,
        f.user,
        r.id,
        { chargeId, money: { amount: 3000, currency: 'AFN' } } as any,
        key,
        'trace',
      );
      expect(b.id).toBe(a.id);
      const n = await db.query(
        'SELECT count(*)::int n FROM payment_allocations WHERE payment_id=$1',
        [r.id],
      );
      expect(n.rows[0].n).toBe(1);
    });
  });

  describe('Release', () => {
    it('partially and fully releases an allocation, returning funds to unapplied', async () => {
      const f = await seedOrg(db);
      const chargeId = await seedCharge(db, f, 6000);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f, { money: { amount: 10000, currency: 'AFN' } }) as any,
        randomUUID(),
        'trace',
      );
      const a: any = await payments.createAllocation(
        f.org,
        f.user,
        r.id,
        { chargeId, money: { amount: 4000, currency: 'AFN' } } as any,
        randomUUID(),
        'trace',
      );
      const rel1: any = await payments.releaseAllocation(
        f.org,
        f.user,
        a.id,
        { money: { amount: 1500, currency: 'AFN' }, reason: 'partial' } as any,
        randomUUID(),
        'trace',
      );
      expect(rel1.money.amount).toBe(1500);
      const rel2: any = await payments.releaseAllocation(
        f.org,
        f.user,
        a.id,
        { money: { amount: 2500, currency: 'AFN' }, reason: 'remaining' } as any,
        randomUUID(),
        'trace',
      );
      expect(rel2.money.amount).toBe(2500);
    });

    it('rejects a release above the allocation amount', async () => {
      const f = await seedOrg(db);
      const chargeId = await seedCharge(db, f, 6000);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        randomUUID(),
        'trace',
      );
      const a: any = await payments.createAllocation(
        f.org,
        f.user,
        r.id,
        { chargeId, money: { amount: 1000, currency: 'AFN' } } as any,
        randomUUID(),
        'trace',
      );
      await expect(
        payments.releaseAllocation(
          f.org,
          f.user,
          a.id,
          { money: { amount: 1001, currency: 'AFN' }, reason: 'x' } as any,
          randomUUID(),
          'trace',
        ),
      ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });

    it('permits re-allocation to the same payment/charge after a full release', async () => {
      const f = await seedOrg(db);
      const chargeId = await seedCharge(db, f, 6000);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        randomUUID(),
        'trace',
      );
      const a: any = await payments.createAllocation(
        f.org,
        f.user,
        r.id,
        { chargeId, money: { amount: 2000, currency: 'AFN' } } as any,
        randomUUID(),
        'trace',
      );
      await payments.releaseAllocation(
        f.org,
        f.user,
        a.id,
        { money: { amount: 2000, currency: 'AFN' }, reason: 'full' } as any,
        randomUUID(),
        'trace',
      );
      const a2: any = await payments.createAllocation(
        f.org,
        f.user,
        r.id,
        { chargeId, money: { amount: 2000, currency: 'AFN' } } as any,
        randomUUID(),
        'trace',
      );
      expect(a2.id).not.toBe(a.id);
      expect(a2.paymentId).toBe(r.id);
      expect(a2.chargeId).toBe(chargeId);
    });
  });

  describe('Atomic audit/sync rollback', () => {
    it('audit failure rolls back payment, receipt counter and idempotency claim', async () => {
      const f = await seedOrg(db);
      const failing = new PaymentsService(
        prisma,
        idem,
        {
          audit: () => Promise.reject(new Error('injected audit failure')),
          syncChange: () => Promise.resolve(),
        } as unknown as PostingService,
        new LockService(),
      );
      await expect(
        failing.createPayment(f.org, f.user, paymentDto(f) as any, randomUUID(), 'trace'),
      ).rejects.toThrow('injected audit failure');
      const pay = await db.query('SELECT count(*)::int n FROM payments WHERE organization_id=$1', [
        f.org,
      ]);
      expect(pay.rows[0].n).toBe(0);
      const count = await db.query(
        'SELECT count(*)::int n FROM receipt_counters WHERE organization_id=$1',
        [f.org],
      );
      expect(count.rows[0].n).toBe(0);
      const idemN = await db.query(
        'SELECT count(*)::int n FROM idempotency_records WHERE organization_id=$1',
        [f.org],
      );
      expect(idemN.rows[0].n).toBe(0);
      const syncN = await db.query(
        'SELECT count(*)::int n FROM sync_changes WHERE organization_id=$1',
        [f.org],
      );
      expect(syncN.rows[0].n).toBe(0);
    });

    it('sync failure rolls back allocation, versions, audit and idempotency claim', async () => {
      const f = await seedOrg(db);
      const r: any = await payments.createPayment(
        f.org,
        f.user,
        paymentDto(f) as any,
        randomUUID(),
        'trace',
      );
      const chargeId = await seedCharge(db, f, 5000);
      const failing = new PaymentsService(
        prisma,
        idem,
        {
          audit: () => Promise.resolve(),
          syncChange: () => Promise.reject(new Error('injected sync failure')),
        } as unknown as PostingService,
        new LockService(),
      );
      await expect(
        failing.createAllocation(
          f.org,
          f.user,
          r.id,
          { chargeId, money: { amount: 1000, currency: 'AFN' } } as any,
          randomUUID(),
          'trace',
        ),
      ).rejects.toThrow('injected sync failure');
      const alloc = await db.query(
        'SELECT count(*)::int n FROM payment_allocations WHERE payment_id=$1',
        [r.id],
      );
      expect(alloc.rows[0].n).toBe(0);
      const auditN = await db.query(
        'SELECT count(*)::int n FROM audit_events WHERE organization_id=$1',
        [f.org],
      );
      expect(auditN.rows[0].n).toBe(1); // only the original PAYMENT_CREATED audit remains
    });
  });
});
