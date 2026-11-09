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

function assertLocalTestHost(): void {
  let host = '';
  let db = '';
  try {
    const u = new URL(BASE_URL);
    host = u.hostname;
    db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {}
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || !['eskan_dev', 'eskan_test', 'eskan_testing'].includes(db)) {
    if (process.env.ESKAN_TEST_DB_ALLOW !== '1') throw new Error(`REFUSED: host="${host}" db="${db}" is not local`);
  }
}

interface Fixture {
  org: string; user: string; hostel: string; resident: string; contract: string; package: string;
}

const RENT_SNAPSHOT = [
  { kind: 'ACCOMMODATION', name: 'Room', amount: 10000, deductibleOnAbsence: false },
  { kind: 'BOARD', name: 'Food', amount: 5000, deductibleOnAbsence: true },
  { kind: 'SERVICE', name: 'Laundry', amount: 1000, deductibleOnAbsence: false },
];

async function seedContract(db: Client, overrides: { status?: string; startDate?: string; endDate?: string | null; snapshot?: unknown; rentAmount?: number } = {}) {
  const org = randomUUID(), user = randomUUID(), hostel = randomUUID(), resident = randomUUID(), contract = randomUUID(), pkg = randomUUID();
  await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
  await db.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','User',now())`, [user, `u-${randomUUID()}@example.com`]);
  await db.query(`INSERT INTO hostels (id, organization_id, name, rent_due_day_of_month, absence_min_days, updated_at) VALUES ($1,$2,'H',5,3,now())`, [hostel, org]);
  await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`, [resident, org]);
  await db.query(`INSERT INTO accommodation_packages (id, organization_id, name, updated_at) VALUES ($1,$2,'P',now())`, [pkg, org]);
  const snapshot = overrides.snapshot ?? RENT_SNAPSHOT;
  await db.query(
    `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, end_date, rent_amount, package_id, package_snapshot, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now())`,
    [
      contract, org, hostel, resident, `CNT-${randomUUID().slice(0, 8)}`,
      overrides.status ?? 'ACTIVE', overrides.startDate ?? '2026-10-01', overrides.endDate ?? null,
      overrides.rentAmount ?? 15000, pkg, JSON.stringify(snapshot),
    ],
  );
  return { org, user, hostel, resident, contract, package: pkg } as Fixture;
}

describe('M3a Charge / Billing / Credit (real PostgreSQL + real services)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;
  let charges: ChargesService;

  beforeAll(async () => {
    jest.setTimeout(30000);
    assertLocalTestHost();
    dbName = `eskan_m3a_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    const idem = new IdempotencyService(prisma);
    const posting = new PostingService();
    const locks = new LockService();
    charges = new ChargesService(prisma, idem, posting, locks);
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

  const chargeDto = (f: Fixture, overrides: Record<string, unknown> = {}) => ({
    residentId: f.resident,
    type: 'RENT',
    contractId: f.contract,
    entrySide: 'DEBIT',
    money: { amount: 15000, currency: 'AFN' },
    periodStart: '2026-11-01',
    periodEnd: '2026-12-01',
    dueDate: '2026-11-05',
    ...overrides,
  });

  describe('Charge', () => {
    it('RENT without contractId is rejected', async () => {
      const f = await seedContract(db);
      await expect(charges.createCharge(f.org, f.user, chargeDto(f, { contractId: undefined }) as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('creates a DEBIT RENT charge with audit + sync + idempotency', async () => {
      const f = await seedContract(db);
      const key = randomUUID();
      const r: any = await charges.createCharge(f.org, f.user, chargeDto(f) as any, key, 'trace-1');
      expect(r.entrySide).toBe('DEBIT');
      expect(r.money.amount).toBe(15000);
      const audit = await db.query('SELECT count(*)::int n FROM audit_events WHERE action=$1', ['CHARGE_CREATED']);
      expect(audit.rows[0].n).toBe(1);
      const sync = await db.query('SELECT count(*)::int n FROM sync_changes WHERE entity_type=$1', ['CHARGE']);
      expect(sync.rows[0].n).toBe(1);
      const r2: any = await charges.createCharge(f.org, f.user, chargeDto(f) as any, key, 'trace-1');
      expect(r2.id).toBe(r.id);
      const rows = await db.query('SELECT count(*)::int n FROM charges WHERE organization_id=$1', [f.org]);
      expect(rows.rows[0].n).toBe(1);
    });

    it('two different keys for same contract+period → one charge only', async () => {
      const f = await seedContract(db);
      await charges.createCharge(f.org, f.user, chargeDto(f) as any, randomUUID(), 'trace');
      await expect(charges.createCharge(f.org, f.user, chargeDto(f) as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
      const rows = await db.query('SELECT count(*)::int n FROM charges WHERE organization_id=$1', [f.org]);
      expect(rows.rows[0].n).toBe(1);
    });

    it('creates a positive CREDIT charge with entrySide CREDIT', async () => {
      const f = await seedContract(db);
      const r: any = await charges.createCharge(f.org, f.user, chargeDto(f, { type: 'ADJUSTMENT', contractId: undefined, entrySide: 'CREDIT', description: 'Overcharge refund', money: { amount: 500, currency: 'AFN' } }) as any, randomUUID(), 'trace');
      expect(r.entrySide).toBe('CREDIT');
      expect(r.money.amount).toBe(500);
    });

    it('RENT with a non-canonical (mid-month) period is rejected', async () => {
      const f = await seedContract(db);
      await expect(
        charges.createCharge(f.org, f.user, chargeDto(f, { periodStart: '2026-11-16', periodEnd: '2026-12-01' }) as any, randomUUID(), 'trace'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('CREDIT without a reason is rejected', async () => {
      const f = await seedContract(db);
      await expect(
        charges.createCharge(f.org, f.user, chargeDto(f, { type: 'ADJUSTMENT', contractId: undefined, entrySide: 'CREDIT', money: { amount: 500, currency: 'AFN' } }) as any, randomUUID(), 'trace'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('CREDIT classified as RENT is rejected (must be ADJUSTMENT)', async () => {
      const f = await seedContract(db);
      await expect(
        charges.createCharge(f.org, f.user, chargeDto(f, { entrySide: 'CREDIT', description: 'refund', money: { amount: 500, currency: 'AFN' } }) as any, randomUUID(), 'trace'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('zero amount violates the DB CHECK (23514)', async () => {
      const f = await seedContract(db);
      await expect(db.query(`INSERT INTO charges (id, organization_id, resident_id, type, entry_side, amount, period_start, period_end, due_date, updated_at) VALUES ($1,$2,$3,'OTHER','DEBIT',0,'2026-11-01','2026-12-01','2026-11-01',now())`, [randomUUID(), f.org, f.resident])).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('DB-level RENT integrity', () => {
    it('RENT without contract_id is rejected by the DB CHECK', async () => {
      const f = await seedContract(db);
      await expect(
        db.query(
          `INSERT INTO charges (id, organization_id, resident_id, type, entry_side, amount, period_start, period_end, due_date, updated_at)
           VALUES ($1,$2,$3,'RENT','DEBIT',100,'2026-11-01','2026-12-01','2026-11-01',now())`,
          [randomUUID(), f.org, f.resident],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('RENT with contract_id is accepted', async () => {
      const f = await seedContract(db);
      await expect(
        db.query(
          `INSERT INTO charges (id, organization_id, resident_id, contract_id, type, entry_side, amount, period_start, period_end, due_date, updated_at)
           VALUES ($1,$2,$3,$4,'RENT','DEBIT',100,'2026-11-01','2026-12-01','2026-11-01',now())`,
          [randomUUID(), f.org, f.resident, f.contract],
        ),
      ).resolves.toBeDefined();
    });

    it('two RENT charges for the same org+contract+month → only one is accepted', async () => {
      const f = await seedContract(db);
      const ins = (id: string) =>
        db.query(
          `INSERT INTO charges (id, organization_id, resident_id, contract_id, type, entry_side, amount, period_start, period_end, due_date, updated_at)
           VALUES ($1,$2,$3,$4,'RENT','DEBIT',100,'2026-11-01','2026-12-01','2026-11-01',now())`,
          [id, f.org, f.resident, f.contract],
        );
      await ins(randomUUID());
      await expect(ins(randomUUID())).rejects.toMatchObject({ code: '23505' });
    });

    it('two ADJUSTMENT charges without contract are allowed', async () => {
      const f = await seedContract(db);
      const ins = (id: string) =>
        db.query(
          `INSERT INTO charges (id, organization_id, resident_id, type, entry_side, amount, period_start, period_end, due_date, updated_at)
           VALUES ($1,$2,$3,'ADJUSTMENT','CREDIT',100,'2026-11-01','2026-11-30','2026-11-01',now())`,
          [id, f.org, f.resident],
        );
      await ins(randomUUID());
      await expect(ins(randomUUID())).resolves.toBeDefined();
    });
  });

  describe('Billing', () => {
    it('preview writes nothing to the database', async () => {
      const f = await seedContract(db);
      const before = await db.query('SELECT count(*)::int n FROM charges');
      const p: any = await charges.previewBilling(f.org, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any);
      expect(p.lines.length).toBe(1);
      const after = await db.query('SELECT count(*)::int n FROM charges');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('posts a full 30-day month from package snapshot components', async () => {
      const f = await seedContract(db);
      const r: any = await charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace');
      expect(r.totalAmount).toBe('16000');
      const chargesQ = await db.query(`SELECT amount FROM charges WHERE type='RENT' AND contract_id=$1`, [f.contract]);
      expect(chargesQ.rows[0].amount).toBe(16000);
    });

    it('prorates a partial month (contract starts mid-month)', async () => {
      const f = await seedContract(db, { startDate: '2026-11-16' });
      const r: any = await charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace');
      expect(r.totalAmount).toBe('8000'); // 15 of 30 days
    });

    it('full months of 28/29/30/31 days are exact', async () => {
      const cases: Array<[string, string]> = [['2026-02-01', '2026-03-01'], ['2024-02-01', '2024-03-01'], ['2026-04-01', '2026-05-01'], ['2026-01-01', '2026-02-01']];
      for (const [start, end] of cases) {
        const f = await seedContract(db, { startDate: start });
        const r: any = await charges.postBilling(f.org, f.user, { periodStart: start, periodEnd: end } as any, randomUUID(), 'trace');
        expect(r.totalAmount).toBe('16000');
      }
    });

    it('re-post of the same period is rejected', async () => {
      const f = await seedContract(db);
      await charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace');
      await expect(charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });

    it('package snapshot is immutable (current package change does not affect contract)', async () => {
      const f = await seedContract(db, { startDate: '2026-11-01' });
      await db.query(`INSERT INTO accommodation_package_components (id, package_id, kind, name, amount, deductible_on_absence, sort_order) VALUES ($1,$2,'ACCOMMODATION','Room2',99999,false,0)`, [randomUUID(), f.package]);
      const r: any = await charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace');
      expect(r.totalAmount).toBe('16000');
    });

    it('does not bill a non-ACTIVE (DRAFT) contract', async () => {
      const f = await seedContract(db, { status: 'DRAFT', startDate: '2026-11-01' });
      const p: any = await charges.previewBilling(f.org, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any);
      expect(p.lines.length).toBe(0);
    });

    it('bills a CLOSED contract for its actual occupied days (prorated to endDate)', async () => {
      const f = await seedContract(db, { status: 'CLOSED', startDate: '2026-11-01', endDate: '2026-11-16' });
      const r: any = await charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace');
      expect(r.totalAmount).toBe('8000'); // 15 of 30 days of 16000
    });

    it('does not bill a CLOSED contract that ended before the period', async () => {
      const f = await seedContract(db, { status: 'CLOSED', startDate: '2026-09-01', endDate: '2026-10-31' });
      const p: any = await charges.previewBilling(f.org, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any);
      expect(p.lines.length).toBe(0);
    });

    it('does not bill a TERMINATED contract', async () => {
      const f = await seedContract(db, { status: 'TERMINATED', startDate: '2026-11-01' });
      const p: any = await charges.previewBilling(f.org, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any);
      expect(p.lines.length).toBe(0);
    });

    it('rejects a non-canonical (mid-month or multi-month) period', async () => {
      const f = await seedContract(db);
      await expect(charges.postBilling(f.org, f.user, { periodStart: '2026-11-16', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2027-01-01' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects posting a billing run with no chargeable contracts', async () => {
      const f = await seedContract(db);
      await db.query(`DELETE FROM stay_contracts WHERE organization_id=$1`, [f.org]);
      await expect(charges.postBilling(f.org, f.user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
      const runs = await db.query('SELECT count(*)::int n FROM billing_runs WHERE organization_id=$1', [f.org]);
      expect(runs.rows[0].n).toBe(0);
    });

    it('uses each hostel rent_due_day_of_month for its own contracts', async () => {
      const org = randomUUID(), user = randomUUID();
      const hostelA = randomUUID(), hostelB = randomUUID();
      const residentA = randomUUID(), residentB = randomUUID();
      const contractA = randomUUID(), contractB = randomUUID();
      const pkg = randomUUID();
      await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
      await db.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','User',now())`, [user, `u-${randomUUID()}@example.com`]);
      await db.query(`INSERT INTO hostels (id, organization_id, name, rent_due_day_of_month, absence_min_days, updated_at) VALUES ($1,$2,'A',5,3,now()), ($3,$2,'B',10,3,now())`, [hostelA, org, hostelB]);
      await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RA',now()), ($3,$2,'RB',now())`, [residentA, org, residentB]);
      await db.query(`INSERT INTO accommodation_packages (id, organization_id, name, updated_at) VALUES ($1,$2,'P',now())`, [pkg, org]);
      const snap = JSON.stringify(RENT_SNAPSHOT);
      await db.query(
        `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, package_id, package_snapshot, updated_at)
         VALUES ($1,$2,$3,$4,'C1','ACTIVE','2026-10-01',15000,$5,$6::jsonb,now()), ($7,$2,$8,$9,'C2','ACTIVE','2026-10-01',15000,$5,$6::jsonb,now())`,
        [contractA, org, hostelA, residentA, pkg, snap, contractB, hostelB, residentB],
      );
      await charges.postBilling(org, user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace');
      const due = await db.query(`SELECT to_char(due_date, 'YYYY-MM-DD') AS d FROM charges WHERE organization_id=$1 ORDER BY due_date`, [org]);
      expect(due.rows.map((r: any) => r.d)).toEqual(['2026-11-05', '2026-11-10']);
    });

    it('aggregate totalAmount exceeds int32 without overflow', async () => {
      const org = randomUUID(), user = randomUUID(), hostel = randomUUID();
      const residentA = randomUUID(), residentB = randomUUID();
      const contractA = randomUUID(), contractB = randomUUID();
      const pkg = randomUUID();
      await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Org',now())`, [org]);
      await db.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','User',now())`, [user, `u-${randomUUID()}@e.com`]);
      await db.query(`INSERT INTO hostels (id, organization_id, name, rent_due_day_of_month, absence_min_days, updated_at) VALUES ($1,$2,'H',5,3,now())`, [hostel, org]);
      await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RA',now()), ($3,$2,'RB',now())`, [residentA, org, residentB]);
      await db.query(`INSERT INTO accommodation_packages (id, organization_id, name, updated_at) VALUES ($1,$2,'P',now())`, [pkg, org]);
      const snap = JSON.stringify([{ kind: 'ACCOMMODATION', name: 'Room', amount: 2000000000, deductibleOnAbsence: false }]);
      await db.query(
        `INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, status, start_date, rent_amount, package_id, package_snapshot, updated_at)
         VALUES ($1,$2,$3,$4,'C1','ACTIVE','2026-10-01',2000000000,$5,$6::jsonb,now()), ($7,$2,$3,$8,'C2','ACTIVE','2026-10-01',2000000000,$5,$6::jsonb,now())`,
        [contractA, org, hostel, residentA, pkg, snap, contractB, residentB],
      );
      const r: any = await charges.postBilling(org, user, { periodStart: '2026-11-01', periodEnd: '2026-12-01' } as any, randomUUID(), 'trace');
      expect(r.totalAmount).toBe('4000000000');
      const row = await db.query('SELECT total_amount::text t FROM billing_runs WHERE organization_id=$1', [org]);
      expect(row.rows[0].t).toBe('4000000000');
    });
  });

  async function seedAbsence(f: Fixture, departure: string, returnDate: string) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, status, planned_departure_date, expected_return_date, actual_departure_date, actual_return_date, approved_at, requested_by_user_id, updated_at)
       VALUES ($1,$2,$3,$4,'RETURNED',$5,$6,$7,$8,now(),$9,now())`,
      [id, f.org, f.resident, f.contract, departure, returnDate, departure, returnDate, f.user],
    );
    return id;
  }

  describe('Absence credit', () => {
    it('below threshold (2 nights) produces no credit', async () => {
      const f = await seedContract(db);
      const absenceId = await seedAbsence(f, '2026-11-01', '2026-11-03');
      const r: any = await charges.generateAbsenceCredits(f.org, f.user, absenceId, randomUUID(), 'trace');
      expect(r.credits.length).toBe(0);
      expect(r.totalCredit).toBe('0');
    });

    it('at exactly the threshold (3 nights) generates a credit, excluding the return day', async () => {
      const f = await seedContract(db);
      const absenceId = await seedAbsence(f, '2026-11-01', '2026-11-04');
      const r: any = await charges.generateAbsenceCredits(f.org, f.user, absenceId, randomUUID(), 'trace');
      expect(r.credits.length).toBe(1);
      // Only deductible component (Board 5000) prorated over 3 of 30 days = 500
      expect(r.totalCredit).toBe('500');
      // return day not counted
      expect((r.credits[0] as any).periodEnd).toBe('2026-11-04');
    });

    it('credits only deductible, non-ACCOMMODATION components', async () => {
      const f = await seedContract(db);
      const absenceId = await seedAbsence(f, '2026-11-01', '2026-12-01');
      const r: any = await charges.generateAbsenceCredits(f.org, f.user, absenceId, randomUUID(), 'trace');
      // full Nov month: only Board (5000) is creditable (Room+Laundry excluded)
      expect(r.totalCredit).toBe('5000');
      const breakdown = await db.query(`SELECT count(*)::int n FROM charge_package_components c JOIN absence_credits a ON a.charge_id=c.charge_id WHERE a.absence_id=$1`, [absenceId]);
      expect(breakdown.rows[0].n).toBe(1);
    });

    it('splits a multi-month absence into monthly credit lines', async () => {
      const f = await seedContract(db);
      const absenceId = await seedAbsence(f, '2026-01-25', '2026-03-05');
      const r: any = await charges.generateAbsenceCredits(f.org, f.user, absenceId, randomUUID(), 'trace');
      expect(r.credits.length).toBe(3);
      expect((r.credits[0] as any).periodStart).toBe('2026-01-25');
      expect((r.credits[2] as any).periodStart).toBe('2026-03-01');
    });

    it('retry with same key replays; different key returns existing credits without duplicates', async () => {
      const f = await seedContract(db);
      const absenceId = await seedAbsence(f, '2026-11-01', '2026-11-04');
      const key = randomUUID();
      const r1: any = await charges.generateAbsenceCredits(f.org, f.user, absenceId, key, 'trace');
      const r2: any = await charges.generateAbsenceCredits(f.org, f.user, absenceId, key, 'trace');
      expect(r2.credits.length).toBe(r1.credits.length);
      const r3: any = await charges.generateAbsenceCredits(f.org, f.user, absenceId, randomUUID(), 'trace');
      expect(r3.credits.length).toBe(r1.credits.length);
      const rows = await db.query(`SELECT count(*)::int n FROM absence_credits WHERE absence_id=$1`, [absenceId]);
      expect(rows.rows[0].n).toBe(1);
    });

    it('rejects credit generation for a non-RETURNED (APPROVED) absence', async () => {
      const f = await seedContract(db);
      const id = randomUUID();
      await db.query(
        `INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, status, planned_departure_date, expected_return_date, requested_by_user_id, updated_at)
         VALUES ($1,$2,$3,$4,'APPROVED','2026-11-01','2026-11-10',$5,now())`,
        [id, f.org, f.resident, f.contract, f.user],
      );
      await expect(charges.generateAbsenceCredits(f.org, f.user, id, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });

    it('rejects an APPROVED absence even when all return dates are present (must be RETURNED)', async () => {
      const f = await seedContract(db);
      const id = randomUUID();
      await db.query(
        `INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, status, planned_departure_date, expected_return_date, actual_departure_date, actual_return_date, approved_at, requested_by_user_id, updated_at)
         VALUES ($1,$2,$3,$4,'APPROVED','2026-11-01','2026-11-10','2026-11-01','2026-11-04',now(),$5,now())`,
        [id, f.org, f.resident, f.contract, f.user],
      );
      await expect(charges.generateAbsenceCredits(f.org, f.user, id, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });

    it('rejects a RETURNED absence missing actual return data', async () => {
      const f = await seedContract(db);
      const id = randomUUID();
      await db.query(
        `INSERT INTO temporary_absences (id, organization_id, resident_id, contract_id, status, planned_departure_date, expected_return_date, actual_departure_date, actual_return_date, approved_at, requested_by_user_id, updated_at)
         VALUES ($1,$2,$3,$4,'RETURNED','2026-11-01','2026-11-10','2026-11-01',NULL,now(),$5,now())`,
        [id, f.org, f.resident, f.contract, f.user],
      );
      await expect(charges.generateAbsenceCredits(f.org, f.user, id, randomUUID(), 'trace')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    });
  });
});