import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { LockService } from '../../src/common/concurrency/lock.service';
import { ContractsService } from '../../src/contracts/contracts.service';

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

interface LegacyFixture { org: string; hostel: string; resident: string; contract: string; }

/**
 * Seeds a legacy stay_contract DIRECTLY in PostgreSQL (bypassing the service
 * and its YEARLY rejection) so the regression test exercises the exact data a
 * pre-M3a database would contain: a DRAFT contract with billing_cycle=YEARLY.
 */
async function seedLegacyDraft(db: Client, billingCycle: 'MONTHLY' | 'YEARLY'): Promise<LegacyFixture> {
  const org = randomUUID(), hostel = randomUUID(), resident = randomUUID(), contract = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await db.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`, [hostel, org]);
  await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
  await db.query(
    `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, billing_cycle, updated_at)
     VALUES ($1,$2,$3,$4,$5,'DRAFT','2026-11-01',5000,$6,now())`,
    [contract, org, hostel, resident, `CNT-${randomUUID().slice(0, 8)}`, billingCycle],
  );
  return { org, hostel, resident, contract };
}

function editDto(f: LegacyFixture, extra: Record<string, unknown> = {}) {
  return {
    hostelId: f.hostel,
    residentId: f.resident,
    startDate: '2026-11-01',
    rent: { amount: 5000, currency: 'AFN' },
    notes: 'edited without touching billingCycle',
    ...extra,
  };
}

describe('M3a legacy YEARLY contract regression (real PostgreSQL + real services)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;
  let contracts: ContractsService;

  beforeAll(async () => {
    jest.setTimeout(30000);
    assertLocalTestHost();
    dbName = `eskan_year_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

  it('preserves a legacy YEARLY draft when billingCycle is omitted (no silent MONTHLY downgrade)', async () => {
    const f = await seedLegacyDraft(db, 'YEARLY');

    // Prove the legacy row really is YEARLY before we touch it.
    const before = await db.query(`SELECT billing_cycle, version FROM stay_contracts WHERE id=$1`, [f.contract]);
    expect(before.rows[0].billing_cycle).toBe('YEARLY');

    // Update only notes/other fields, omitting billingCycle entirely.
    const r: any = await contracts.update(f.org, f.contract, 1, editDto(f) as any);

    expect(r.billingCycle).toBe('YEARLY');
    const after = await db.query(`SELECT billing_cycle, version FROM stay_contracts WHERE id=$1`, [f.contract]);
    expect(after.rows[0].billing_cycle).toBe('YEARLY');
    expect(after.rows[0].version).toBe(2);
  });

  it('rejects activating a legacy YEARLY draft and leaves it DRAFT', async () => {
    const f = await seedLegacyDraft(db, 'YEARLY');

    await expect(
      contracts.activate(f.org, f.contract, randomUUID(), randomUUID(), 1),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });

    const row = await db.query(`SELECT status, version, billing_cycle FROM stay_contracts WHERE id=$1`, [f.contract]);
    expect(row.rows[0].status).toBe('DRAFT');
    expect(row.rows[0].version).toBe(1);
    expect(row.rows[0].billing_cycle).toBe('YEARLY');
  });

  it('applies an explicit MONTHLY conversion and then activates normally', async () => {
    const f = await seedLegacyDraft(db, 'YEARLY');

    // Explicit decision to convert the legacy cycle to MONTHLY.
    const updated: any = await contracts.update(f.org, f.contract, 1, editDto(f, { billingCycle: 'MONTHLY' }) as any);
    expect(updated.billingCycle).toBe('MONTHLY');

    const mid = await db.query(`SELECT billing_cycle, version FROM stay_contracts WHERE id=$1`, [f.contract]);
    expect(mid.rows[0].billing_cycle).toBe('MONTHLY');
    expect(mid.rows[0].version).toBe(2);

    // Now activation succeeds.
    const activated: any = await contracts.activate(f.org, f.contract, randomUUID(), randomUUID(), 2);
    expect(activated.status).toBe('ACTIVE');

    const final = await db.query(`SELECT status, version, billing_cycle FROM stay_contracts WHERE id=$1`, [f.contract]);
    expect(final.rows[0].status).toBe('ACTIVE');
    expect(final.rows[0].version).toBe(3);
    expect(final.rows[0].billing_cycle).toBe('MONTHLY');
  });
});