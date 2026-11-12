import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { LockService } from '../../src/common/concurrency/lock.service';
import { ContractsService } from '../../src/contracts/contracts.service';
import { AssignmentsService } from '../../src/assignments/assignments.service';

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

function withDatabase(dbName: string): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

// Fail-closed guard: this harness creates/drops a throwaway database, so it
// must never be pointed at a non-local (production/shared) PostgreSQL server.
function assertLocalTestHost(): void {
  let host = '';
  let db = '';
  try {
    const u = new URL(BASE_URL);
    host = u.hostname;
    db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {
    /* keep empty */
  }
  const okHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  const okDb = ['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db);
  if ((!okHost || !okDb) && process.env.ESKAN_TEST_DB_ALLOW !== '1') {
    throw new Error(
      `REFUSED: integration harness creates/drops a throwaway DB; host="${host}" db="${db}" is not a local ` +
        `dev/test database. Set ESKAN_TEST_DB_ALLOW=1 only for an explicitly sanctioned test server.`,
    );
  }
}

function ymd(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

interface Fixture {
  org: string;
  hostel: string;
  room: string;
  bed: string;
  bed2: string;
  resident: string;
  contract: string;
  assignment: string;
}

async function seedFixture(db: Client): Promise<Fixture> {
  const org = randomUUID(),
    hostel = randomUUID(),
    room = randomUUID(),
    bed = randomUUID(),
    bed2 = randomUUID(),
    resident = randomUUID(),
    contract = randomUUID(),
    assignment = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await db.query(
    `INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`,
    [hostel, org],
  );
  await db.query(
    `INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'R1',1,now())`,
    [room, org, hostel],
  );
  await db.query(
    `INSERT INTO beds (id, organization_id, room_id, code, updated_at) VALUES ($1,$2,$3,'B1',now())`,
    [bed, org, room],
  );
  await db.query(
    `INSERT INTO beds (id, organization_id, room_id, code, updated_at) VALUES ($1,$2,$3,'B2',now())`,
    [bed2, org, room],
  );
  await db.query(
    `INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`,
    [resident, org],
  );
  await db.query(
    `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,$5,'ACTIVE','2020-01-01',5000,now())`,
    [contract, org, hostel, resident, `CNT-${randomUUID().slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO bed_assignments (id, organization_id, bed_id, resident_id, contract_id, status, start_date, updated_at) VALUES ($1,$2,$3,$4,$5,'ACTIVE','2020-01-01',now())`,
    [assignment, org, bed, resident, contract],
  );
  return { org, hostel, room, bed, bed2, resident, contract, assignment };
}

describe('M-1 concurrency (real PostgreSQL + real Prisma/services)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;
  let contracts: ContractsService;
  let assignments: AssignmentsService;

  beforeAll(async () => {
    jest.setTimeout(30000);
    assertLocalTestHost();
    dbName = `eskan_m1_conc_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    process.env.DATABASE_URL = url;

    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(
        `prisma migrate deploy failed (status ${r.status}):\n${r.stdout ?? ''}\n${r.stderr ?? ''}`,
      );
    }

    prisma = new PrismaService();
    const idem = new IdempotencyService(prisma);
    const locks = new LockService();
    contracts = new ContractsService(prisma, idem, locks);
    assignments = new AssignmentsService(prisma, idem, locks);

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

  it('double concurrent checkout (different keys, same version) → exactly one succeeds', async () => {
    const f = await seedFixture(db);
    const results = await Promise.allSettled([
      contracts.checkout(f.org, f.contract, randomUUID(), randomUUID(), 1),
      contracts.checkout(f.org, f.contract, randomUUID(), randomUUID(), 1),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const fail = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ok[0].value.status).toBe('CLOSED');
    expect(fail).toHaveLength(1);
    expect((fail[0].reason as { code?: string }).code).toBe('RESOURCE_VERSION_CONFLICT');

    const row = await db.query(`SELECT status, version, end_date FROM stay_contracts WHERE id=$1`, [
      f.contract,
    ]);
    expect(row.rows[0].status).toBe('CLOSED');
    expect(row.rows[0].version).toBe(2); // exactly ONE ACTIVE→CLOSED transition
    expect(row.rows[0].end_date).not.toBeNull();

    const asg = await db.query(
      `SELECT status, end_reason, end_date FROM bed_assignments WHERE contract_id=$1`,
      [f.contract],
    );
    expect(asg.rows).toHaveLength(1);
    expect(asg.rows[0].status).toBe('ENDED');
    expect(asg.rows[0].end_reason).toBe('CHECKOUT');
    expect(ymd(asg.rows[0].end_date)).toBe(ymd(row.rows[0].end_date));
  });

  it('double concurrent checkout (SAME key) → idempotent replay, single transition', async () => {
    const f = await seedFixture(db);
    const key = randomUUID();
    const [r1, r2] = await Promise.all([
      contracts.checkout(f.org, f.contract, randomUUID(), key, 1),
      contracts.checkout(f.org, f.contract, randomUUID(), key, 1),
    ]);
    expect(r1.status).toBe('CLOSED');
    expect(r2.status).toBe('CLOSED');

    const row = await db.query(`SELECT version FROM stay_contracts WHERE id=$1`, [f.contract]);
    expect(row.rows[0].version).toBe(2);

    const rec = await db.query(
      `SELECT count(*)::int n FROM idempotency_records WHERE organization_id=$1 AND idempotency_key=$2`,
      [f.org, key],
    );
    expect(rec.rows[0].n).toBe(1); // exactly one claimed record
  });

  it('checkout vs transfer race → contract CLOSED with no active assignment', async () => {
    const f = await seedFixture(db);
    const results = await Promise.allSettled([
      contracts.checkout(f.org, f.contract, randomUUID(), randomUUID(), 1),
      assignments.transfer(
        f.org,
        f.assignment,
        randomUUID(),
        { bedId: f.bed2, startDate: '2025-01-01' },
        randomUUID(),
        1,
      ),
    ]);

    expect(results[0].status).toBe('fulfilled'); // checkout always reaches CLOSED

    const row = await db.query(`SELECT status, end_date FROM stay_contracts WHERE id=$1`, [
      f.contract,
    ]);
    expect(row.rows[0].status).toBe('CLOSED');
    expect(row.rows[0].end_date).not.toBeNull();

    const active = await db.query(
      `SELECT count(*)::int n FROM bed_assignments WHERE contract_id=$1 AND status='ACTIVE'`,
      [f.contract],
    );
    expect(active.rows[0].n).toBe(0); // invariant: no CLOSED contract with an active assignment

    const asgs = await db.query(
      `SELECT bed_id, status, end_reason, end_date FROM bed_assignments WHERE contract_id=$1`,
      [f.contract],
    );
    for (const a of asgs.rows) {
      expect(a.status).toBe('ENDED');
      expect(a.end_reason).not.toBeNull(); // no assignment left with legacy NULL reason
    }

    if (asgs.rows.length === 2) {
      // transfer won the race, then checkout closed the destination assignment
      expect(results[1].status).toBe('fulfilled');
      const from = asgs.rows.find((a: { bed_id: string }) => a.bed_id === f.bed);
      const to = asgs.rows.find((a: { bed_id: string }) => a.bed_id === f.bed2);
      expect(from.end_reason).toBe('TRANSFER');
      expect(ymd(from.end_date)).toBe('2025-01-01'); // transitionStart, no +1
      expect(to.end_reason).toBe('CHECKOUT');
      expect(ymd(to.end_date)).toBe(ymd(row.rows[0].end_date));
    } else {
      expect(asgs.rows).toHaveLength(1);
      expect(asgs.rows[0].end_reason).toBe('CHECKOUT');
      // transfer legitimately lost the race (assignment already ended / contract closed)
    }
  });

  it('same idempotency key with a different expectedVersion → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const f = await seedFixture(db);
    const key = randomUUID();
    await contracts.checkout(f.org, f.contract, randomUUID(), key, 1);

    await expect(contracts.checkout(f.org, f.contract, randomUUID(), key, 2)).rejects.toMatchObject(
      {
        code: 'IDEMPOTENCY_KEY_REUSED',
      },
    );
  });

  it('checkout persists PERMANENT idempotency retention (expires_at IS NULL)', async () => {
    const f = await seedFixture(db);
    const key = randomUUID();
    await contracts.checkout(f.org, f.contract, randomUUID(), key, 1);

    const rec = await db.query(
      `SELECT retention_class, expires_at FROM idempotency_records WHERE organization_id=$1 AND idempotency_key=$2`,
      [f.org, key],
    );
    expect(rec.rows).toHaveLength(1);
    expect(rec.rows[0].retention_class).toBe('PERMANENT');
    expect(rec.rows[0].expires_at).toBeNull();
  });
});
