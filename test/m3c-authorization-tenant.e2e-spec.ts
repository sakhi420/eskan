import { INestApplication, HttpStatus, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { validationExceptionFactory } from '../src/common/validation/validation-exception.factory';

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const ROLE_NAMES = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] as const;
type OrganizationRole = (typeof ROLE_NAMES)[number];

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
    if (process.env.ESKAN_TEST_DB_ALLOW !== '1') {
      throw new Error(`REFUSED: host="${host}" db="${db}" is not local`);
    }
  }
}

describe('P1-7 financial authorization and tenant isolation (HTTP)', () => {
  let app: INestApplication;
  let adminDb: Client;
  let db: Client;
  let dbName: string;
  let tokens: TokenService;
  let organizationA: string;
  let organizationB: string;
  let usersA: Record<OrganizationRole, string>;
  let userB: string;
  let residentB: string;
  let paymentB: string;
  let depositB: string;
  let expenseB: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    assertLocalTestHost();
    jest.setTimeout(120000);
    dbName = `eskan_p17_http_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    adminDb = new Client({ connectionString: withDatabase('postgres') });
    await adminDb.connect();
    await adminDb.query(`CREATE DATABASE "${dbName}"`);

    const databaseUrl = withDatabase(dbName);
    const migration = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    if (migration.status !== 0) {
      throw new Error(`migrate deploy failed:\n${migration.stdout}\n${migration.stderr}`);
    }

    db = new Client({ connectionString: databaseUrl });
    await db.connect();

    organizationA = randomUUID();
    organizationB = randomUUID();
    usersA = {
      OWNER: randomUUID(),
      ADMIN: randomUUID(),
      OPERATOR: randomUUID(),
      VIEWER: randomUUID(),
    };
    userB = randomUUID();
    residentB = randomUUID();
    paymentB = randomUUID();
    depositB = randomUUID();
    expenseB = randomUUID();

    await db.query(
      `INSERT INTO organizations (id, name, updated_at)
       VALUES ($1, 'Tenant A', now()), ($2, 'Tenant B', now())`,
      [organizationA, organizationB],
    );

    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES
         ($1, 'p17-owner@eskan.test', 'x', 'Owner A', now()),
         ($2, 'p17-admin@eskan.test', 'x', 'Admin A', now()),
         ($3, 'p17-operator@eskan.test', 'x', 'Operator A', now()),
         ($4, 'p17-viewer@eskan.test', 'x', 'Viewer A', now()),
         ($5, 'p17-owner-b@eskan.test', 'x', 'Owner B', now())`,
      [usersA.OWNER, usersA.ADMIN, usersA.OPERATOR, usersA.VIEWER, userB],
    );

    await db.query(
      `INSERT INTO organization_memberships
         (id, organization_id, user_id, role, active, updated_at)
       VALUES
         ($1, $2, $3, 'OWNER', true, now()),
         ($4, $2, $5, 'ADMIN', true, now()),
         ($6, $2, $7, 'OPERATOR', true, now()),
         ($8, $2, $9, 'VIEWER', true, now()),
         ($10, $11, $12, 'OWNER', true, now())`,
      [
        randomUUID(),
        organizationA,
        usersA.OWNER,
        randomUUID(),
        usersA.ADMIN,
        randomUUID(),
        usersA.OPERATOR,
        randomUUID(),
        usersA.VIEWER,
        randomUUID(),
        organizationB,
        userB,
      ],
    );

    await db.query(
      `INSERT INTO residents (id, organization_id, full_name, updated_at)
       VALUES ($1, $2, 'Resident B', now())`,
      [residentB, organizationB],
    );
    await db.query(
      `INSERT INTO payments
         (id, organization_id, resident_id, status, amount, method, received_at, receipt_number, updated_at)
       VALUES ($1, $2, $3, 'POSTED', 500, 'CASH', '2026-11-01', 'TENANT-B-REC-001', now())`,
      [paymentB, organizationB, residentB],
    );
    await db.query(
      `INSERT INTO deposit_transactions
         (id, organization_id, resident_id, type, status, amount, received_at, actor_user_id, updated_at)
       VALUES ($1, $2, $3, 'RECEIVED', 'POSTED', 700, '2026-11-01', $4, now())`,
      [depositB, organizationB, residentB, userB],
    );
    await db.query(
      `INSERT INTO expenses
         (id, organization_id, category, status, amount, spent_at, payment_method, actor_user_id, updated_at)
       VALUES ($1, $2, 'TENANT-B-EXPENSE', 'POSTED', 300, '2026-11-01', 'CASH', $3, now())`,
      [expenseB, organizationB, userB],
    );

    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'test-p1-7-http-secret-which-is-long-enough';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
      ],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    await app.init();
    tokens = app.get(TokenService);
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await db?.end().catch(() => {});
    if (adminDb) {
      await adminDb.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await adminDb.end().catch(() => {});
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }, 60000);

  async function tokenFor(role: OrganizationRole | 'OWNER_B'): Promise<string> {
    const userId = role === 'OWNER_B' ? userB : usersA[role];
    const email =
      role === 'OWNER_B' ? 'p17-owner-b@eskan.test' : `p17-${role.toLowerCase()}@eskan.test`;
    const { token } = await tokens.signAccessToken({
      sub: userId,
      email,
      fullName: role,
      isPlatformAdmin: false,
    });
    return token;
  }

  async function postAs(
    role: OrganizationRole | 'OWNER_B',
    path: string,
    body: Record<string, unknown>,
    organizationId = organizationA,
  ) {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${await tokenFor(role)}`)
      .set('X-Organization-Id', organizationId)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  async function getAs(
    role: OrganizationRole | 'OWNER_B',
    path: string,
    organizationId = organizationA,
  ) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${await tokenFor(role)}`)
      .set('X-Organization-Id', organizationId);
  }

  async function expectRoleGate(
    path: string,
    body: Record<string, unknown>,
    allowedRoles: OrganizationRole[],
  ): Promise<void> {
    for (const role of ROLE_NAMES) {
      const response = await postAs(role, path, body);
      const allowed = allowedRoles.includes(role);
      expect(response.status).toBe(allowed ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN);
      expect(response.body.code).toBe(allowed ? 'RESOURCE_NOT_FOUND' : 'FORBIDDEN');
    }
  }

  const money = { amount: 100, currency: 'AFN' };
  const reversalBody = { reason: 'P1-7 permission test' };
  const refundBody = { money, reason: 'P1-7 permission test' };
  const depositCreateBody = { money, receivedAt: '2026-11-02', reason: 'P1-7 permission test' };

  it('requires authentication for financial endpoints', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/payments');
    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('keeps read-only payment access available to all four organization roles', async () => {
    for (const role of ROLE_NAMES) {
      const response = await getAs(role, '/api/v1/payments');
      expect(response.status).toBe(HttpStatus.OK);
    }
  });

  it('allows OWNER/ADMIN/OPERATOR and denies VIEWER on payment creation', async () => {
    await expectRoleGate(
      '/api/v1/payments',
      {
        residentId: randomUUID(),
        money,
        method: 'CASH',
        receivedAt: '2026-11-02',
      },
      ['OWNER', 'ADMIN', 'OPERATOR'],
    );
  });

  it('allows OWNER/ADMIN/OPERATOR and denies VIEWER on deposit receipt creation', async () => {
    await expectRoleGate(
      `/api/v1/residents/${randomUUID()}/deposit-transactions`,
      depositCreateBody,
      ['OWNER', 'ADMIN', 'OPERATOR'],
    );
  });

  it('allows OWNER/ADMIN/OPERATOR and denies VIEWER on paid expense creation', async () => {
    for (const role of ROLE_NAMES) {
      const response = await postAs(role, '/api/v1/expenses', {
        category: `ROLE-MATRIX-${role}`,
        money,
        spentAt: '2026-11-02',
        paymentMethod: 'CASH',
      });
      if (role === 'VIEWER') {
        expect(response.status).toBe(HttpStatus.FORBIDDEN);
        expect(response.body.code).toBe('FORBIDDEN');
      } else {
        expect(response.status).toBe(HttpStatus.CREATED);
        expect(response.body.data.status).toBe('POSTED');
        expect(response.body.data.actorUserId).toBe(usersA[role]);
      }
    }
  });

  it('restricts allocations to OWNER/ADMIN/OPERATOR and allocation release to OWNER/ADMIN', async () => {
    await expectRoleGate(
      `/api/v1/payments/${randomUUID()}/allocations`,
      { chargeId: randomUUID(), money },
      ['OWNER', 'ADMIN', 'OPERATOR'],
    );
    await expectRoleGate(`/api/v1/allocations/${randomUUID()}/release`, refundBody, [
      'OWNER',
      'ADMIN',
    ]);
  });

  it('restricts payment refund and reversal to OWNER/ADMIN', async () => {
    await expectRoleGate(`/api/v1/payments/${randomUUID()}/refund`, refundBody, ['OWNER', 'ADMIN']);
    await expectRoleGate(`/api/v1/payments/${randomUUID()}/reverse`, reversalBody, [
      'OWNER',
      'ADMIN',
    ]);
  });

  it('restricts deposit application and application reversal to OWNER/ADMIN', async () => {
    await expectRoleGate(
      `/api/v1/residents/${randomUUID()}/deposits/apply`,
      {
        depositTransactionId: randomUUID(),
        reason: 'P1-7 permission test',
        charges: [{ chargeId: randomUUID(), money }],
      },
      ['OWNER', 'ADMIN'],
    );
    await expectRoleGate(`/api/v1/deposit-applications/${randomUUID()}/reverse`, reversalBody, [
      'OWNER',
      'ADMIN',
    ]);
  });

  it('restricts deposit refund, forfeit, and reversal to OWNER/ADMIN', async () => {
    const depositId = randomUUID();
    await expectRoleGate(`/api/v1/deposit-transactions/${depositId}/refund`, refundBody, [
      'OWNER',
      'ADMIN',
    ]);
    await expectRoleGate(`/api/v1/deposit-transactions/${depositId}/forfeit`, refundBody, [
      'OWNER',
      'ADMIN',
    ]);
    await expectRoleGate(`/api/v1/deposit-transactions/${depositId}/reverse`, reversalBody, [
      'OWNER',
      'ADMIN',
    ]);
  });

  it('restricts expense and charge reversal to OWNER/ADMIN', async () => {
    await expectRoleGate(`/api/v1/expenses/${randomUUID()}/reverse`, reversalBody, [
      'OWNER',
      'ADMIN',
    ]);
    await expectRoleGate(`/api/v1/charges/${randomUUID()}/reverse`, reversalBody, [
      'OWNER',
      'ADMIN',
    ]);
  });

  it('restricts CREDIT charge posting to OWNER/ADMIN even though OPERATOR can post DEBIT', async () => {
    const body = {
      residentId: randomUUID(),
      type: 'OTHER',
      entrySide: 'CREDIT',
      money,
      periodStart: '2026-11-01',
      periodEnd: '2026-12-01',
      dueDate: '2026-11-01',
    };
    await expectRoleGate('/api/v1/charges', body, ['OWNER', 'ADMIN']);
  });

  it('returns 404 when a member selects an organization they do not belong to', async () => {
    const response = await getAs('OWNER_B', '/api/v1/payments', organizationA);
    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(response.body.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.detail).not.toContain(organizationA);
  });

  it('prevents BOLA reads across payment, expense, and resident-deposit resources', async () => {
    const payment = await getAs('OWNER', `/api/v1/payments/${paymentB}`);
    expect(payment.status).toBe(HttpStatus.NOT_FOUND);
    expect(payment.body.code).toBe('RESOURCE_NOT_FOUND');

    const expense = await getAs('OWNER', `/api/v1/expenses/${expenseB}`);
    expect(expense.status).toBe(HttpStatus.NOT_FOUND);
    expect(expense.body.code).toBe('RESOURCE_NOT_FOUND');

    const deposits = await getAs('OWNER', `/api/v1/residents/${residentB}/deposit-transactions`);
    expect(deposits.status).toBe(HttpStatus.NOT_FOUND);
    expect(deposits.body.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('prevents BOLA mutations and leaves the other tenant financial rows unchanged', async () => {
    const paymentReverse = await postAs(
      'OWNER',
      `/api/v1/payments/${paymentB}/reverse`,
      reversalBody,
    );
    expect(paymentReverse.status).toBe(HttpStatus.NOT_FOUND);

    const depositRefund = await postAs(
      'OWNER',
      `/api/v1/deposit-transactions/${depositB}/refund`,
      refundBody,
    );
    expect(depositRefund.status).toBe(HttpStatus.NOT_FOUND);

    const expenseReverse = await postAs(
      'OWNER',
      `/api/v1/expenses/${expenseB}/reverse`,
      reversalBody,
    );
    expect(expenseReverse.status).toBe(HttpStatus.NOT_FOUND);

    const [payment, deposit, expense, reversals, depositChildren] = await Promise.all([
      db.query('SELECT status FROM payments WHERE id=$1 AND organization_id=$2', [
        paymentB,
        organizationB,
      ]),
      db.query('SELECT type, status FROM deposit_transactions WHERE id=$1 AND organization_id=$2', [
        depositB,
        organizationB,
      ]),
      db.query('SELECT status FROM expenses WHERE id=$1 AND organization_id=$2', [
        expenseB,
        organizationB,
      ]),
      db.query(
        `SELECT count(*)::int n FROM ledger_reversals
         WHERE organization_id=$1 AND source_id IN ($2, $3)`,
        [organizationB, paymentB, expenseB],
      ),
      db.query(
        `SELECT count(*)::int n FROM deposit_transactions
         WHERE organization_id=$1 AND source_deposit_transaction_id=$2`,
        [organizationB, depositB],
      ),
    ]);
    expect(payment.rows[0].status).toBe('POSTED');
    expect(deposit.rows[0]).toEqual({ type: 'RECEIVED', status: 'POSTED' });
    expect(expense.rows[0].status).toBe('POSTED');
    expect(reversals.rows[0].n).toBe(0);
    expect(depositChildren.rows[0].n).toBe(0);
  });
});
