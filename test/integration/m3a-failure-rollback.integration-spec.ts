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

/** A PostingService stub whose controlled `fail` path throws inside the SAME transaction. */
function failingPosting(fail: 'audit' | 'syncChange'): PostingService {
  return {
    audit: fail === 'audit'
      ? () => Promise.reject(new Error('injected audit failure'))
      : () => Promise.resolve(),
    syncChange: fail === 'syncChange'
      ? () => Promise.reject(new Error('injected sync failure'))
      : () => Promise.resolve(),
  } as unknown as PostingService;
}

describe('M3a failure rollback (real PostgreSQL)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    jest.setTimeout(30000);
    dbName = `eskan_m3af_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
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

  async function seed() {
    const org = randomUUID(), user = randomUUID(), hostel = randomUUID(), resident = randomUUID(), contract = randomUUID(), pkg = randomUUID();
    await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','User',now())`, [user, `u-${randomUUID()}@e.com`]);
    await db.query(`INSERT INTO hostels (id, organization_id, name, rent_due_day_of_month, absence_min_days, updated_at) VALUES ($1,$2,'H',5,3,now())`, [hostel, org]);
    await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
    await db.query(`INSERT INTO accommodation_packages (id, organization_id, name, updated_at) VALUES ($1,$2,'P',now())`, [pkg, org]);
    const snapshot = JSON.stringify([
      { kind: 'ACCOMMODATION', name: 'Room', amount: 10000, deductibleOnAbsence: false },
      { kind: 'BOARD', name: 'Food', amount: 5000, deductibleOnAbsence: true },
    ]);
    await db.query(
      `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, package_id, package_snapshot, updated_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE','2026-10-01',10000,$6,$7::jsonb,now())`,
      [contract, org, hostel, resident, `CNT-${randomUUID().slice(0, 8)}`, pkg, snapshot],
    );
    return { org, user, resident, contract };
  }

  const chargeDto = (f: { org: string; resident: string; contract: string }) => ({
    residentId: f.resident, type: 'RENT' as const, contractId: f.contract, entrySide: 'DEBIT' as const,
    money: { amount: 10000, currency: 'AFN' }, periodStart: '2026-11-01', periodEnd: '2026-12-01', dueDate: '2026-11-05',
  });

  it('audit failure rolls back charge + idempotency + sync + cursor', async () => {
    const f = await seed();
    const charges = new ChargesService(prisma, new IdempotencyService(prisma), failingPosting('audit'), new LockService());
    await expect(charges.createCharge(f.org, f.user, chargeDto(f) as any, randomUUID(), 'trace')).rejects.toThrow('injected audit failure');

    const chargesN = await db.query('SELECT count(*)::int n FROM charges WHERE organization_id=$1', [f.org]);
    expect(chargesN.rows[0].n).toBe(0);
    const idemN = await db.query('SELECT count(*)::int n FROM idempotency_records WHERE organization_id=$1', [f.org]);
    expect(idemN.rows[0].n).toBe(0);
    const syncN = await db.query('SELECT count(*)::int n FROM sync_changes WHERE organization_id=$1', [f.org]);
    expect(syncN.rows[0].n).toBe(0);
    const cursorN = await db.query('SELECT count(*)::int n FROM organization_sync_state WHERE organization_id=$1', [f.org]);
    expect(cursorN.rows[0].n).toBe(0);
  });

  it('sync failure rolls back charge + audit + idempotency + cursor', async () => {
    const f = await seed();
    const charges = new ChargesService(prisma, new IdempotencyService(prisma), failingPosting('syncChange'), new LockService());
    await expect(charges.createCharge(f.org, f.user, chargeDto(f) as any, randomUUID(), 'trace')).rejects.toThrow('injected sync failure');

    const chargesN = await db.query('SELECT count(*)::int n FROM charges WHERE organization_id=$1', [f.org]);
    expect(chargesN.rows[0].n).toBe(0);
    const auditN = await db.query('SELECT count(*)::int n FROM audit_events WHERE organization_id=$1', [f.org]);
    expect(auditN.rows[0].n).toBe(0);
    const idemN = await db.query('SELECT count(*)::int n FROM idempotency_records WHERE organization_id=$1', [f.org]);
    expect(idemN.rows[0].n).toBe(0);
    const cursorN = await db.query('SELECT count(*)::int n FROM organization_sync_state WHERE organization_id=$1', [f.org]);
    expect(cursorN.rows[0].n).toBe(0);
  });

  it('audit failure rolls back the whole billing run (run + charges + idempotency + cursor)', async () => {
    const f = await seed();
    const charges = new ChargesService(prisma, new IdempotencyService(prisma), failingPosting('audit'), new LockService());
    await expect(charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace')).rejects.toThrow('injected audit failure');

    const runs = await db.query('SELECT count(*)::int n FROM billing_runs WHERE organization_id=$1', [f.org]);
    expect(runs.rows[0].n).toBe(0);
    const chargesN = await db.query('SELECT count(*)::int n FROM charges WHERE organization_id=$1', [f.org]);
    expect(chargesN.rows[0].n).toBe(0);
    const idemN = await db.query('SELECT count(*)::int n FROM idempotency_records WHERE organization_id=$1', [f.org]);
    expect(idemN.rows[0].n).toBe(0);
  });

  it('audit failure rolls back absence credits and leaves the absence RETURNED', async () => {
    const f = await seed();
    const absenceId = randomUUID();
    await db.query(
      `INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, status, planned_departure_date, expected_return_date, actual_departure_date, actual_return_date, approved_at, requested_by_user_id, updated_at)
       VALUES ($1,$2,$3,$4,'RETURNED','2026-11-01','2026-11-10','2026-11-01','2026-11-04',now(),$5,now())`,
      [absenceId, f.org, f.resident, f.contract, f.user],
    );
    const charges = new ChargesService(prisma, new IdempotencyService(prisma), failingPosting('audit'), new LockService());
    await expect(charges.generateAbsenceCredits(f.org, f.user, absenceId, randomUUID(), 'trace')).rejects.toThrow('injected audit failure');

    const credits = await db.query('SELECT count(*)::int n FROM absence_credits WHERE absence_id=$1', [absenceId]);
    expect(credits.rows[0].n).toBe(0);
    const status = await db.query('SELECT status FROM temporary_absences WHERE id=$1', [absenceId]);
    expect(status.rows[0].status).toBe('RETURNED');
    const chargeN = await db.query('SELECT count(*)::int n FROM charges WHERE organization_id=$1', [f.org]);
    expect(chargeN.rows[0].n).toBe(0);
    const auditN = await db.query('SELECT count(*)::int n FROM audit_events WHERE organization_id=$1', [f.org]);
    expect(auditN.rows[0].n).toBe(0);
    const syncN = await db.query('SELECT count(*)::int n FROM sync_changes WHERE organization_id=$1', [f.org]);
    expect(syncN.rows[0].n).toBe(0);
  });

  it('sync failure rolls back absence credits + charge + audit + sync + idempotency', async () => {
    const f = await seed();
    const absenceId = randomUUID();
    await db.query(
      `INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, status, planned_departure_date, expected_return_date, actual_departure_date, actual_return_date, approved_at, requested_by_user_id, updated_at)
       VALUES ($1,$2,$3,$4,'RETURNED','2026-11-01','2026-11-10','2026-11-01','2026-11-04',now(),$5,now())`,
      [absenceId, f.org, f.resident, f.contract, f.user],
    );
    const charges = new ChargesService(prisma, new IdempotencyService(prisma), failingPosting('syncChange'), new LockService());
    await expect(charges.generateAbsenceCredits(f.org, f.user, absenceId, randomUUID(), 'trace')).rejects.toThrow('injected sync failure');

    const credits = await db.query('SELECT count(*)::int n FROM absence_credits WHERE absence_id=$1', [absenceId]);
    expect(credits.rows[0].n).toBe(0);
    const status = await db.query('SELECT status FROM temporary_absences WHERE id=$1', [absenceId]);
    expect(status.rows[0].status).toBe('RETURNED');
    const chargeN = await db.query('SELECT count(*)::int n FROM charges WHERE organization_id=$1', [f.org]);
    expect(chargeN.rows[0].n).toBe(0);
    const auditN = await db.query('SELECT count(*)::int n FROM audit_events WHERE organization_id=$1', [f.org]);
    expect(auditN.rows[0].n).toBe(0);
    const syncN = await db.query('SELECT count(*)::int n FROM sync_changes WHERE organization_id=$1', [f.org]);
    expect(syncN.rows[0].n).toBe(0);
  });
});