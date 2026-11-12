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

describe('M3b authorization before idempotency replay (HTTP)', () => {
  let app: INestApplication;
  let admin: Client;
  let db: Client;
  let dbName: string;
  let tokens: TokenService;
  let orgA: string;
  let ownerA: string;
  let operatorA: string;
  let viewerA: string;
  let ownerB: string;
  let resident: string;
  let chargeId: string;
  let paymentId: string;
  let allocationId: string;

  beforeAll(async () => {
    assertLocalTestHost();
    jest.setTimeout(120000);
    dbName = `eskan_m3bh_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    viewerA = randomUUID();
    ownerB = randomUUID();
    resident = randomUUID();
    chargeId = randomUUID();

    await db.query(
      `INSERT INTO organizations (id, name, updated_at) VALUES ($1,'OrgA',now()), ($2,'OrgB',now())`,
      [orgA, orgB],
    );
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,'x','Owner A',now()), ($3,$4,'x','Op A',now()), ($5,$6,'x','Viewer A',now()), ($7,$8,'x','Owner B',now())`,
      [
        ownerA,
        'a@example.com',
        operatorA,
        'op@example.com',
        viewerA,
        'v@example.com',
        ownerB,
        'b@example.com',
      ],
    );
    await db.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, active, updated_at)
       VALUES ($1,$2,$3,'OWNER',true,now()), ($4,$2,$5,'OPERATOR',true,now()), ($6,$2,$7,'VIEWER',true,now()), ($8,$9,$10,'OWNER',true,now())`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        operatorA,
        randomUUID(),
        viewerA,
        randomUUID(),
        orgB,
        ownerB,
      ],
    );
    await db.query(
      `INSERT INTO residents (id, organization_id, full_name, updated_at) VALUES ($1,$2,'R',now())`,
      [resident, orgA],
    );
    await db.query(
      `INSERT INTO charges (id, organization_id, resident_id, type, amount, period_start, period_end, due_date, updated_at)
       VALUES ($1,$2,$3,'OTHER',10000,'2026-11-01','2026-12-01','2026-11-01',now())`,
      [chargeId, orgA, resident],
    );

    process.env.JWT_SECRET = 'test-m3b-secret';
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

  it('owner creates a payment (201)', async () => {
    const t = await tokenFor(ownerA, 'a@example.com', 'Owner A');
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        residentId: resident,
        money: { amount: 10000, currency: 'AFN' },
        method: 'CASH',
        receivedAt: '2026-11-02',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('POSTED');
    expect(res.body.data.receiptNumber).toMatch(/^\d{10}$/);
    paymentId = res.body.data.id;
  });

  it('operator creates an allocation (201)', async () => {
    const t = await tokenFor(operatorA, 'op@example.com', 'Op A');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/allocations`)
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', randomUUID())
      .send({ chargeId, money: { amount: 4000, currency: 'AFN' } });
    expect(res.status).toBe(201);
    allocationId = res.body.data.id;
  });

  it('viewer cannot create a payment (403)', async () => {
    const t = await tokenFor(viewerA, 'v@example.com', 'Viewer A');
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        residentId: resident,
        money: { amount: 1000, currency: 'AFN' },
        method: 'CASH',
        receivedAt: '2026-11-02',
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('viewer cannot replay an owner payment with the same key (403 before replay)', async () => {
    const key = randomUUID();
    const ownerT = await tokenFor(ownerA, 'a@example.com', 'Owner A');
    const ok = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerT}`)
      .set('Idempotency-Key', key)
      .send({
        residentId: resident,
        money: { amount: 2500, currency: 'AFN' },
        method: 'CASH',
        receivedAt: '2026-11-02',
        payerName: 'Alice',
        payerPhone: '0700000000',
      });
    expect(ok.status).toBe(201);
    expect(ok.body.data.payerName).toBe('Alice');

    const viewerT = await tokenFor(viewerA, 'v@example.com', 'Viewer A');
    const forbidden = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${viewerT}`)
      .set('Idempotency-Key', key)
      .send({
        residentId: resident,
        money: { amount: 2500, currency: 'AFN' },
        method: 'CASH',
        receivedAt: '2026-11-02',
        payerName: 'Alice',
        payerPhone: '0700000000',
      });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).not.toHaveProperty('payerName');
  });

  it('operator cannot release an allocation (403); owner can (200)', async () => {
    const opT = await tokenFor(operatorA, 'op@example.com', 'Op A');
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/allocations/${allocationId}/release`)
      .set('Authorization', `Bearer ${opT}`)
      .set('Idempotency-Key', randomUUID())
      .send({ money: { amount: 500, currency: 'AFN' }, reason: 'adjust' });
    expect(forbidden.status).toBe(403);

    const ownerT = await tokenFor(ownerA, 'a@example.com', 'Owner A');
    const ok = await request(app.getHttpServer())
      .post(`/api/v1/allocations/${allocationId}/release`)
      .set('Authorization', `Bearer ${ownerT}`)
      .set('Idempotency-Key', randomUUID())
      .send({ money: { amount: 500, currency: 'AFN' }, reason: 'adjust' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.money.amount).toBe(500);
  });

  it('operator cannot replay an owner release with the same key (403 before replay)', async () => {
    const key = randomUUID();
    const ownerT = await tokenFor(ownerA, 'a@example.com', 'Owner A');
    const ok = await request(app.getHttpServer())
      .post(`/api/v1/allocations/${allocationId}/release`)
      .set('Authorization', `Bearer ${ownerT}`)
      .set('Idempotency-Key', key)
      .send({ money: { amount: 200, currency: 'AFN' }, reason: 'again' });
    expect(ok.status).toBe(200);

    const opT = await tokenFor(operatorA, 'op@example.com', 'Op A');
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/allocations/${allocationId}/release`)
      .set('Authorization', `Bearer ${opT}`)
      .set('Idempotency-Key', key)
      .send({ money: { amount: 200, currency: 'AFN' }, reason: 'again' });
    expect(forbidden.status).toBe(403);

    const cross = await request(app.getHttpServer())
      .post(`/api/v1/allocations/${allocationId}/release`)
      .set('Authorization', `Bearer ${await tokenFor(ownerB, 'b@example.com', 'Owner B')}`)
      .set('X-Organization-Id', orgA)
      .set('Idempotency-Key', key)
      .send({ money: { amount: 200, currency: 'AFN' }, reason: 'again' });
    expect(cross.status).toBe(403);
  });

  it('rejects invalid payment method and zero/negative amounts (422)', async () => {
    const t = await tokenFor(ownerA, 'a@example.com', 'Owner A');
    const base = { residentId: resident, receivedAt: '2026-11-02' };
    const method = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ...base, money: { amount: 1000, currency: 'AFN' }, method: 'CARD' });
    expect(method.status).toBe(422);

    const zero = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ...base, money: { amount: 0, currency: 'AFN' }, method: 'CASH' });
    expect(zero.status).toBe(422);

    const negative = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ...base, money: { amount: -5, currency: 'AFN' }, method: 'CASH' });
    expect(negative.status).toBe(422);

    const missingMoney = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', randomUUID())
      .send({ residentId: resident, receivedAt: '2026-11-02', method: 'CASH' });
    expect(missingMoney.status).toBe(422);
  });

  it('rejects a client-supplied official receiptNumber (whitelist, 422)', async () => {
    const t = await tokenFor(ownerA, 'a@example.com', 'Owner A');
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        residentId: resident,
        money: { amount: 1000, currency: 'AFN' },
        method: 'CASH',
        receivedAt: '2026-11-02',
        receiptNumber: 'RCP-999',
      });
    expect(res.status).toBe(422);
  });
});
