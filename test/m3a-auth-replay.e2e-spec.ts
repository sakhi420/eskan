import { INestApplication, RequestMethod, ValidationPipe, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { validationExceptionFactory } from '../src/common/validation/validation-exception.factory';

const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

function withDatabase(dbName: string): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

describe('M3a authorization before idempotency replay (HTTP)', () => {
  let app: INestApplication;
  let admin: Client;
  let db: Client;
  let dbName: string;
  let tokens: TokenService;
  let orgA: string;
  let ownerA: string;
  let operatorA: string;
  let ownerB: string;
  let resident: string;
  let idemKey: string;
  let creditBody: Record<string, unknown>;

  beforeAll(async () => {
    jest.setTimeout(120000);
    dbName = `eskan_m3ah_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    admin = new Client({ connectionString: withDatabase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = withDatabase(dbName);
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);

    db = new Client({ connectionString: url });
    await db.connect();

    orgA = randomUUID();
    const orgB = randomUUID();
    ownerA = randomUUID();
    operatorA = randomUUID();
    ownerB = randomUUID();
    resident = randomUUID();

    await db.query(
      `INSERT INTO organizations (id, name, updated_at) VALUES ($1,'OrgA',now()), ($2,'OrgB',now())`,
      [orgA, orgB],
    );
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','Owner A',now()), ($3,$4,'x','Operator A',now()), ($5,$6,'x','Owner B',now())`,
      [ownerA, 'a@example.com', operatorA, 'op@example.com', ownerB, 'b@example.com'],
    );
    await db.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, active, updated_at)
       VALUES ($1,$2,$3,'OWNER',true,now()), ($4,$2,$5,'OPERATOR',true,now()), ($6,$7,$8,'OWNER',true,now())`,
      [randomUUID(), orgA, ownerA, randomUUID(), operatorA, randomUUID(), orgB, ownerB],
    );
    await db.query(
      `INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`,
      [resident, orgA],
    );

    process.env.JWT_SECRET = 'test-m3a-secret';
    process.env.DATABASE_URL = url;
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

    idemKey = randomUUID();
    creditBody = {
      residentId: resident,
      type: 'ADJUSTMENT',
      entrySide: 'CREDIT',
      money: { amount: 500, currency: 'AFN' },
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      dueDate: '2026-11-01',
      description: 'Overcharge refund',
    };
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await db?.end().catch(() => {});
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  }, 60000);

  async function tokenFor(userId: string, email: string, fullName: string): Promise<string> {
    const { token } = await tokens.signAccessToken({
      sub: userId,
      email,
      fullName,
      isPlatformAdmin: false,
    });
    return token;
  }

  it('owner posts a credit (authorized)', async () => {
    const t = await tokenFor(ownerA, 'a@example.com', 'Owner A');
    const res = await request(app.getHttpServer())
      .post('/api/v1/charges')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', idemKey)
      .send(creditBody);
    expect(res.status).toBe(201);
    expect(res.body.data.money.amount).toBe(500);
  });

  it('operator (not allowed to post credits) cannot replay the owner credit', async () => {
    const t = await tokenFor(operatorA, 'op@example.com', 'Operator A');
    const res = await request(app.getHttpServer())
      .post('/api/v1/charges')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', idemKey)
      .send(creditBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body).not.toHaveProperty('money');
  });

  it('cross-tenant user cannot replay against another organization', async () => {
    const t = await tokenFor(ownerB, 'b@example.com', 'Owner B');
    const res = await request(app.getHttpServer())
      .post('/api/v1/charges')
      .set('Authorization', `Bearer ${t}`)
      .set('X-Organization-Id', orgA)
      .set('Idempotency-Key', idemKey)
      .send(creditBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('operator cannot post an organization-wide billing run', async () => {
    const t = await tokenFor(operatorA, 'op@example.com', 'Operator A');
    const res = await request(app.getHttpServer())
      .post('/api/v1/billing-runs')
      .set('Authorization', `Bearer ${t}`)
      .set('X-Organization-Id', orgA)
      .set('Idempotency-Key', randomUUID())
      .send({ periodStart: '2026-11-01', periodEnd: '2026-12-01' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('no extra charge or idempotency record was created by the unauthorized replays', async () => {
    const chargesN = await db.query('SELECT count(*)::int n FROM charges');
    expect(chargesN.rows[0].n).toBe(1);
    const billingRunsN = await db.query('SELECT count(*)::int n FROM billing_runs');
    expect(billingRunsN.rows[0].n).toBe(0);
    const idemN = await db.query('SELECT count(*)::int n FROM idempotency_records');
    expect(idemN.rows[0].n).toBe(1);
  });
});
