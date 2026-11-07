import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { LockService } from '../../src/common/concurrency/lock.service';

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

describe('LockService tenant isolation (real PostgreSQL + real Prisma)', () => {
  let admin: Client;
  let db: Client;
  let dbName: string;
  let prisma: PrismaService;
  let locks: LockService;
  let orgA: string;
  let orgB: string;
  let resB: string;

  beforeAll(async () => {
    jest.setTimeout(30000);
    assertLocalTestHost();
    dbName = `eskan_lock_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(`prisma migrate deploy failed (status ${r.status}):\n${r.stdout ?? ''}\n${r.stderr ?? ''}`);
    }
    process.env.DATABASE_URL = url;

    prisma = new PrismaService();
    locks = new LockService();

    db = new Client({ connectionString: url });
    await db.connect();
    orgA = randomUUID();
    orgB = randomUUID();
    resB = randomUUID();
    await db.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'A',now()),($2,'B',now())`, [orgA, orgB]);
    await db.query(`INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'RB',now())`, [resB, orgB]);
  }, 120000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => {});
    await db?.end().catch(() => {});
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  }, 60000);

  it('lockForUpdate refuses to lock without an organizationId', async () => {
    await expect(
      prisma.$transaction(async (tx) => locks.lockForUpdate(tx, 'resident', resB, undefined as unknown as string)),
    ).rejects.toThrow(/organizationId/);
  });

  it('a tenant with the correct org locks the row; a foreign org does NOT block on it', async () => {
    // Transaction 1 (correct org) holds an exclusive lock on the resident row.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await locks.lockForUpdate(tx, 'resident', resB, orgB); // acquires the row lock
        await gate;
      },
      { timeout: 8000 },
    );

    // Give the holder a moment to acquire the lock.
    await new Promise((r) => setTimeout(r, 150));

    // A transaction run as orgA (wrong org) must resolve immediately: its
    // tenant-scoped WHERE matches zero rows, so it neither blocks nor sees
    // another tenant's locked row.
    const start = Date.now();
    await prisma.$transaction(
      async (tx2) => {
        await locks.lockForUpdate(tx2, 'resident', resB, orgA);
      },
      { timeout: 3000 },
    );
    const elapsed = Date.now() - start;

    release();
    await holder;

    expect(elapsed).toBeLessThan(1500);
  });

  it('a correct-org SELECT FOR UPDATE sees the row (1 row), wrong org sees 0 rows', async () => {
    const wrong = await db.query(`SELECT id FROM residents WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [resB, orgA]);
    const right = await db.query(`SELECT id FROM residents WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [resB, orgB]);
    expect(wrong.rowCount).toBe(0);
    expect(right.rowCount).toBe(1);
  });
});