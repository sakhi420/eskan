import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { LockService } from '../../src/common/concurrency/lock.service';
import { PostingService } from '../../src/common/finance/posting.service';
import { ChargesService } from '../../src/charges/charges.service';

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

function withDatabase(dbName: string): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
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

describe('M3a concurrency (real PostgreSQL + barrier)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;
  let charges: ChargesService;

  beforeAll(async () => {
    jest.setTimeout(30000);
    dbName = `eskan_m3ac_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    charges = new ChargesService(prisma, new IdempotencyService(prisma), new PostingService(), new LockService());
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

  async function seed(): Promise<{ org: string; user: string; resident: string; contract: string }> {
    const org = randomUUID(), user = randomUUID(), hostel = randomUUID(), resident = randomUUID(), contract = randomUUID();
    await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','U',now())`, [user, `u-${randomUUID()}@e.com`]);
    await db.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'H',now())`, [hostel, org]);
    await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
    await db.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'CNT','ACTIVE','2026-11-01',15000,now())`, [contract, org, hostel, resident]);
    return { org, user, resident, contract };
  }

  it('two concurrent charges (different keys, same period) yield exactly one charge', async () => {
    const f = await seed();
    const line = (id: string) => ({
      residentId: f.resident, type: 'RENT', contractId: f.contract, entrySide: 'DEBIT',
      money: { amount: 15000, currency: 'AFN' }, periodStart: '2026-11-01', periodEnd: '2026-12-01', dueDate: '2026-11-05', __id: id,
    });
    const gate = barrier(2);
    const fire = async () => {
      await gate();
      return charges.createCharge(f.org, f.user, line(randomUUID()) as any, randomUUID(), 'trace');
    };
    const results: Array<'ok' | 'dupe'> = [];
    await Promise.allSettled([fire(), fire()]).then((res) => {
      for (const r of res) {
        if (r.status === 'fulfilled') results.push('ok');
        else if (r.status === 'rejected' && (r.reason as any)?.code === 'BUSINESS_RULE_VIOLATION') results.push('dupe');
        else throw r.reason;
      }
    });
    expect(results).toContain('ok');
    expect(results).toContain('dupe');
    const rows = await db.query('SELECT count(*)::int n FROM charges WHERE organization_id=$1', [f.org]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('two concurrent billing posts yield exactly one billing run', async () => {
    const f = await seed();
    const gate = barrier(2);
    const fire = async () => {
      await gate();
      return charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace');
    };
    let ok = 0;
    await Promise.allSettled([fire(), fire()]).then((res) => {
      for (const r of res) {
        if (r.status === 'fulfilled') ok += 1;
        else if ((r.reason as any)?.code !== 'BUSINESS_RULE_VIOLATION') throw r.reason;
      }
    });
    expect(ok).toBe(1);
    const runs = await db.query('SELECT count(*)::int n FROM billing_runs WHERE organization_id=$1', [f.org]);
    expect(runs.rows[0].n).toBe(1);
  });

  it('two concurrent absence-credit generations yield exactly one credit set', async () => {
    const f = await seed();
    await db.query(
      `UPDATE stay_contracts SET package_snapshot = $2::jsonb WHERE id = $1`,
      [f.contract, JSON.stringify([{ kind: 'BOARD', name: 'Food', amount: 5000, deductibleOnAbsence: true }])],
    );
    const absenceId = randomUUID();
    await db.query(
      `INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, status, planned_departure_date, expected_return_date, actual_departure_date, actual_return_date, approved_at, requested_by_user_id, updated_at)
       VALUES ($1,$2,$3,$4,'RETURNED','2026-11-01','2026-11-10','2026-11-01','2026-11-04',now(),$5,now())`,
      [absenceId, f.org, f.resident, f.contract, f.user],
    );
    const gate = barrier(2);
    const fire = () => gate().then(() => charges.generateAbsenceCredits(f.org, f.user, absenceId, randomUUID(), 'trace'));
    let ok = 0;
    await Promise.allSettled([fire(), fire()]).then((res) => {
      for (const r of res) {
        if (r.status === 'fulfilled') ok += 1;
        else if ((r.reason as any)?.code !== 'BUSINESS_RULE_VIOLATION') throw r.reason;
      }
    });
    expect(ok).toBeGreaterThanOrEqual(1);
    const rows = await db.query('SELECT count(*)::int n FROM absence_credits WHERE absence_id=$1', [absenceId]);
    expect(rows.rows[0].n).toBe(1);
  });
});