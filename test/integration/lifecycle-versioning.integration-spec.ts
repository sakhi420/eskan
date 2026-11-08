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
  } catch { /* keep empty */ }
  const okHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  const okDb = ['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db);
  if ((!okHost || !okDb) && process.env.ESKAN_TEST_DB_ALLOW !== '1') {
    throw new Error(
      `REFUSED: integration harness creates/drops a throwaway DB; host="${host}" db="${db}" is not a local ` +
        `dev/test database. Set ESKAN_TEST_DB_ALLOW=1 only for an explicitly sanctioned test server.`,
    );
  }
}

interface DraftFixture { org: string; hostel: string; resident: string; contract: string; }

interface ActiveFixture {
  org: string;
  hostel: string;
  room: string;
  bed: string;
  bed2: string;
  resident: string;
  contract: string;
  assignment: string;
}

async function seedDraftFixture(db: Client): Promise<DraftFixture> {
  const org = randomUUID(), hostel = randomUUID(), resident = randomUUID(), contract = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await db.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`, [hostel, org]);
  await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
  await db.query(
    `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,$5,'DRAFT','2020-01-01',5000,now())`,
    [contract, org, hostel, resident, `CNT-${randomUUID().slice(0, 8)}`],
  );
  return { org, hostel, resident, contract };
}

async function seedActiveFixture(db: Client): Promise<ActiveFixture> {
  const org = randomUUID(), hostel = randomUUID(), room = randomUUID(), bed = randomUUID(),
    bed2 = randomUUID(), resident = randomUUID(), contract = randomUUID(), assignment = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await db.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`, [hostel, org]);
  await db.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'R1',1,now())`, [room, org, hostel]);
  await db.query(`INSERT INTO beds (id, organization_id, room_id, code, updated_at) VALUES ($1,$2,$3,'B1',now())`, [bed, org, room]);
  await db.query(`INSERT INTO beds (id, organization_id, room_id, code, updated_at) VALUES ($1,$2,$3,'B2',now())`, [bed2, org, room]);
  await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
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

describe('Lifecycle versioning + idempotency (real PostgreSQL + real services)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;
  let contracts: ContractsService;
  let assignments: AssignmentsService;

  beforeAll(async () => {
    jest.setTimeout(30000);
    assertLocalTestHost();
    dbName = `eskan_life_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
      throw new Error(`prisma migrate deploy failed (status ${r.status}):\n${r.stdout ?? ''}\n${r.stderr ?? ''}`);
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

  describe('contractActivate', () => {
    it('correct version → ACTIVE and version 2', async () => {
      const f = await seedDraftFixture(db);
      const r: any = await contracts.activate(f.org, f.contract, randomUUID(), randomUUID(), 1);
      expect(r.status).toBe('ACTIVE');
      expect(r.version).toBe(2);
      const row = await db.query(`SELECT version FROM stay_contracts WHERE id=$1`, [f.contract]);
      expect(row.rows[0].version).toBe(2);
    });

    it('same key + same version → replay (single transition)', async () => {
      const f = await seedDraftFixture(db);
      const key = randomUUID();
      await contracts.activate(f.org, f.contract, randomUUID(), key, 1);
      const r2: any = await contracts.activate(f.org, f.contract, randomUUID(), key, 1);
      expect(r2.status).toBe('ACTIVE');
      const row = await db.query(`SELECT version FROM stay_contracts WHERE id=$1`, [f.contract]);
      expect(row.rows[0].version).toBe(2);
    });

    it('new key + stale version → RESOURCE_VERSION_CONFLICT', async () => {
      const f = await seedDraftFixture(db);
      await contracts.activate(f.org, f.contract, randomUUID(), randomUUID(), 1);
      await expect(contracts.activate(f.org, f.contract, randomUUID(), randomUUID(), 1)).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    });

    it('same key + different version → IDEMPOTENCY_KEY_REUSED', async () => {
      const f = await seedDraftFixture(db);
      const key = randomUUID();
      await contracts.activate(f.org, f.contract, randomUUID(), key, 1);
      await expect(contracts.activate(f.org, f.contract, randomUUID(), key, 2)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });
  });

  describe('contractTerminate', () => {
    it('DRAFT → TERMINATED and version 2', async () => {
      const f = await seedDraftFixture(db);
      const r: any = await contracts.terminate(f.org, f.contract, randomUUID(), randomUUID(), 1);
      expect(r.status).toBe('TERMINATED');
      expect(r.version).toBe(2);
      const row = await db.query(`SELECT version FROM stay_contracts WHERE id=$1`, [f.contract]);
      expect(row.rows[0].version).toBe(2);
    });

    it('same key + same version → replay (single transition)', async () => {
      const f = await seedDraftFixture(db);
      const key = randomUUID();
      await contracts.terminate(f.org, f.contract, randomUUID(), key, 1);
      const r2: any = await contracts.terminate(f.org, f.contract, randomUUID(), key, 1);
      expect(r2.status).toBe('TERMINATED');
      const row = await db.query(`SELECT version FROM stay_contracts WHERE id=$1`, [f.contract]);
      expect(row.rows[0].version).toBe(2);
    });

    it('new key + stale version → RESOURCE_VERSION_CONFLICT', async () => {
      const f = await seedDraftFixture(db);
      await contracts.terminate(f.org, f.contract, randomUUID(), randomUUID(), 1);
      await expect(contracts.terminate(f.org, f.contract, randomUUID(), randomUUID(), 1)).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    });

    it('same key + different version → IDEMPOTENCY_KEY_REUSED', async () => {
      const f = await seedDraftFixture(db);
      const key = randomUUID();
      await contracts.terminate(f.org, f.contract, randomUUID(), key, 1);
      await expect(contracts.terminate(f.org, f.contract, randomUUID(), key, 2)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('ACTIVE contract → rejected (checkout is the only close path)', async () => {
      const f = await seedActiveFixture(db);
      await expect(contracts.terminate(f.org, f.contract, randomUUID(), randomUUID(), 1)).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });
  });

  describe('assignmentEnd', () => {
    it('ACTIVE → ENDED (MANUAL_END) and version 2', async () => {
      const f = await seedActiveFixture(db);
      const r: any = await assignments.end(f.org, f.assignment, randomUUID(), randomUUID(), 1);
      expect(r.status).toBe('ENDED');
      expect(r.endReason).toBe('MANUAL_END');
      expect(r.version).toBe(2);
      const row = await db.query(`SELECT version FROM bed_assignments WHERE id=$1`, [f.assignment]);
      expect(row.rows[0].version).toBe(2);
    });

    it('same key + same version → replay (single transition)', async () => {
      const f = await seedActiveFixture(db);
      const key = randomUUID();
      await assignments.end(f.org, f.assignment, randomUUID(), key, 1);
      const r2: any = await assignments.end(f.org, f.assignment, randomUUID(), key, 1);
      expect(r2.status).toBe('ENDED');
      const row = await db.query(`SELECT version FROM bed_assignments WHERE id=$1`, [f.assignment]);
      expect(row.rows[0].version).toBe(2);
    });

    it('new key + stale version → RESOURCE_VERSION_CONFLICT', async () => {
      const f = await seedActiveFixture(db);
      await assignments.end(f.org, f.assignment, randomUUID(), randomUUID(), 1);
      await expect(assignments.end(f.org, f.assignment, randomUUID(), randomUUID(), 1)).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    });

    it('same key + different version → IDEMPOTENCY_KEY_REUSED', async () => {
      const f = await seedActiveFixture(db);
      const key = randomUUID();
      await assignments.end(f.org, f.assignment, randomUUID(), key, 1);
      await expect(assignments.end(f.org, f.assignment, randomUUID(), key, 2)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });
  });

  describe('assignmentTransfer', () => {
    it('ends source + creates ONE destination, history preserved', async () => {
      const f = await seedActiveFixture(db);
      const r: any = await assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-01-01' }, randomUUID(), 1);
      expect(r.previous.status).toBe('ENDED');
      expect(r.previous.endReason).toBe('TRANSFER');
      expect(r.assignment.status).toBe('ACTIVE');
      expect(r.assignment.bedId).toBe(f.bed2);
      const asgs = await db.query(`SELECT bed_id, status, end_reason FROM bed_assignments WHERE contract_id=$1`, [f.contract]);
      expect(asgs.rows).toHaveLength(2);
      const src = asgs.rows.find((a: any) => a.bed_id === f.bed);
      const dst = asgs.rows.find((a: any) => a.bed_id === f.bed2);
      expect(src.status).toBe('ENDED');
      expect(src.end_reason).toBe('TRANSFER');
      expect(dst.status).toBe('ACTIVE');
    });

    it('same key + same version → replay (no duplicate destination)', async () => {
      const f = await seedActiveFixture(db);
      const key = randomUUID();
      await assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-01-01' }, key, 1);
      await assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-01-01' }, key, 1);
      const asgs = await db.query(`SELECT count(*)::int n FROM bed_assignments WHERE contract_id=$1`, [f.contract]);
      expect(asgs.rows[0].n).toBe(2);
    });

    it('new key + stale version → RESOURCE_VERSION_CONFLICT', async () => {
      const f = await seedActiveFixture(db);
      await assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-01-01' }, randomUUID(), 1);
      await expect(assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-01-01' }, randomUUID(), 1)).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    });

    it('same key + different version → IDEMPOTENCY_KEY_REUSED', async () => {
      const f = await seedActiveFixture(db);
      const key = randomUUID();
      await assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-01-01' }, key, 1);
      await expect(assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-01-01' }, key, 2)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('same key + different payload → IDEMPOTENCY_KEY_REUSED', async () => {
      const f = await seedActiveFixture(db);
      const key = randomUUID();
      await assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-01-01' }, key, 1);
      await expect(assignments.transfer(f.org, f.assignment, randomUUID(), { bedId: f.bed2, startDate: '2025-02-01' }, key, 1)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });
  });
});