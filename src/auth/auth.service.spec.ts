import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TenantService } from './tenant.service';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

function configStub(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as unknown as ConfigService;
}

function prismaMock() {
  return {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    refreshSession: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    subscriptionPlan: { findUnique: jest.fn() },
    organization: { create: jest.fn() },
    organizationSubscription: { create: jest.fn() },
    subscriptionEvent: { create: jest.fn() },
    organizationMembership: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
}

const USER = {
  id: 'u-1',
  email: 'a@b.c',
  fullName: 'Alice',
  isPlatformAdmin: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeService(overrides: Record<string, any> = {}) {
  const prisma = overrides.prisma ?? prismaMock();
  const passwords = overrides.passwords ?? {
    hash: jest.fn().mockResolvedValue('hashed'),
    verify: jest.fn().mockResolvedValue(true),
  };
  const tokens = overrides.tokens ?? {
    hashToken: jest.fn((raw: string) => `sha256:${raw}`),
    signAccessToken: jest.fn().mockResolvedValue({ token: 'access', expiresIn: 900 }),
    generateRefreshToken: jest.fn().mockReturnValue({ raw: 'refresh-raw', hash: 'refresh-hash' }),
    refreshExpiresAt: jest.fn().mockReturnValue(new Date('2026-02-01T00:00:00.000Z')),
  };
  const tenants = overrides.tenants ?? {
    resolveActiveMembership: jest.fn(),
    listActiveMemberships: jest.fn().mockResolvedValue([
      { membershipId: 'm-1', organizationId: 'org-1', organizationName: 'Org One', role: 'OWNER', active: true },
    ]),
  };
  const config = overrides.config ?? configStub({ 'auth.registrationEnabled': true, trialDays: 30 });

  const svc = new AuthService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    tokens as unknown as TokenService,
    tenants as unknown as TenantService,
    config,
  );
  return { svc, prisma, passwords, tokens, tenants, config };
}

describe('AuthService', () => {
  describe('register', () => {
    it('rejects when registration is disabled', async () => {
      const { svc } = makeService({
        config: configStub({ 'auth.registrationEnabled': false, trialDays: 30 }),
      });
      const dto: RegisterDto = {
        email: 'a@b.c',
        password: 'password123',
        fullName: 'Alice',
        organizationName: 'Org One',
      };

      const promise = svc.register(dto, 'trace-1');
      await expect(promise).rejects.toBeInstanceOf(AppError);
      await expect(promise).rejects.toMatchObject({ code: 'REGISTRATION_DISABLED' });
    });

    it('rejects a duplicate email with a conflict when the password does not match', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue({ ...USER, passwordHash: 'stored-hash' });
      const passwords = { hash: jest.fn(), verify: jest.fn().mockResolvedValue(false) };
      const { svc } = makeService({ prisma, passwords });

      const promise = svc.register(
        { email: 'a@b.c', password: 'password123', fullName: 'Alice', organizationName: 'Org One' },
        'trace-1',
      );
      await expect(promise).rejects.toBeInstanceOf(AppError);
      await expect(promise).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', status: 409 });
    });

    it('recovers a lost-registration retry by issuing a fresh session when the password matches', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue({ ...USER, passwordHash: 'stored-hash' });
      prisma.refreshSession.create.mockResolvedValue({});
      const passwords = { hash: jest.fn(), verify: jest.fn().mockResolvedValue(true) };
      const { svc } = makeService({ prisma, passwords });

      const session = await svc.register(
        { email: 'a@b.c', password: 'correct', fullName: 'Alice', organizationName: 'Org One' },
        'trace-1',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(session.accessToken).toBe('access');
      expect(session.refreshToken).toBe('refresh-raw');
    });

    it('creates user + organization + OWNER membership + trial subscription', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => unknown) =>
        fn({
          subscriptionPlan: {
            findUnique: jest.fn().mockResolvedValue({ id: 'plan-free', code: 'FREE' }),
          },
          user: { create: jest.fn().mockResolvedValue(USER) },
          organization: { create: jest.fn().mockResolvedValue({ id: 'org-1', name: 'Org One' }) },
          organizationSubscription: { create: jest.fn().mockResolvedValue({}) },
          subscriptionEvent: { create: jest.fn().mockResolvedValue({}) },
        }),
      );
      prisma.refreshSession.create.mockResolvedValue({});

      const { svc, tokens } = makeService({ prisma });

      const session = await svc.register(
        { email: 'a@b.c', password: 'password123', fullName: 'Alice', organizationName: 'Org One' },
        'trace-1',
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(session.accessToken).toBe('access');
      expect(session.refreshToken).toBe('refresh-raw');
      expect(session.expiresIn).toBe(900);
      expect(session.user.email).toBe('a@b.c');
      expect(session.memberships).toHaveLength(1);
      expect(tokens.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'u-1', isPlatformAdmin: false }),
      );
    });
  });

  describe('login', () => {
    it('rejects a wrong password without disclosing account existence', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue({ ...USER, passwordHash: 'stored-hash' });
      const passwords = { hash: jest.fn(), verify: jest.fn().mockResolvedValue(false) };
      const { svc } = makeService({ prisma, passwords });

      const promise = svc.login({ email: 'a@b.c', password: 'wrong' } as LoginDto);
      await expect(promise).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        status: 401,
        message: expect.stringContaining('Invalid email or password'),
      });
    });

    it('rejects an unknown email with the same generic message', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue(null);
      const passwords = {
        hash: jest.fn().mockResolvedValue('dummy-hash'),
        verify: jest.fn().mockResolvedValue(true),
      };
      const { svc } = makeService({ prisma, passwords });

      const promise = svc.login({ email: 'ghost@x.y', password: 'whatever' } as LoginDto);
      await expect(promise).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        status: 401,
        message: expect.stringContaining('Invalid email or password'),
      });
    });

    it('issues a session on valid credentials', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue({ ...USER, passwordHash: 'stored-hash' });
      prisma.refreshSession.create.mockResolvedValue({});
      const passwords = { hash: jest.fn(), verify: jest.fn().mockResolvedValue(true) };
      const { svc } = makeService({ prisma, passwords });

      const session = await svc.login({ email: 'a@b.c', password: 'correct' } as LoginDto);
      expect(session.accessToken).toBe('access');
      expect(session.refreshToken).toBe('refresh-raw');
      expect(session.memberships).toHaveLength(1);
    });
  });

  describe('refresh', () => {
    it('rotates the token and marks the old session converted', async () => {
      const prisma = prismaMock();
      prisma.refreshSession.findUnique.mockResolvedValue({
        id: 's-1',
        userId: 'u-1',
        family: 'fam-1',
        expiresAt: new Date(Date.now() + 100_000),
        replacedById: null,
        revokedAt: null,
        user: USER,
      });
      prisma.refreshSession.create.mockResolvedValue({ id: 's-2' });
      prisma.refreshSession.update.mockResolvedValue({});
      const { svc } = makeService({ prisma });

      const session = await svc.refresh({ refreshToken: 'old-token' } as RefreshDto);

      expect(prisma.refreshSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u-1', family: 'fam-1' }),
        }),
      );
      expect(prisma.refreshSession.update).toHaveBeenCalledWith({
        where: { id: 's-1' },
        data: { replacedById: 's-2', revokedAt: expect.any(Date) },
      });
      expect(session.refreshToken).toBe('refresh-raw');
    });

    it('revokes the whole family on token reuse', async () => {
      const prisma = prismaMock();
      prisma.refreshSession.findUnique.mockResolvedValue({
        id: 's-1',
        userId: 'u-1',
        family: 'fam-1',
        expiresAt: new Date(Date.now() + 100_000),
        replacedById: 's-0',
        revokedAt: null,
        user: USER,
      });
      const { svc } = makeService({ prisma });

      const promise = svc.refresh({ refreshToken: 'reused-token' } as RefreshDto);
      await expect(promise).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', family: 'fam-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects an unknown refresh token', async () => {
      const prisma = prismaMock();
      prisma.refreshSession.findUnique.mockResolvedValue(null);
      const { svc } = makeService({ prisma });

      const promise = svc.refresh({ refreshToken: 'unknown' } as RefreshDto);
      await expect(promise).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  describe('changePassword', () => {
    it('rejects an incorrect current password with a conflict', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue({ ...USER, passwordHash: 'stored-hash' });
      const passwords = { hash: jest.fn(), verify: jest.fn().mockResolvedValue(false) };
      const { svc } = makeService({ prisma, passwords });

      const promise = svc.changePassword('u-1', {
        currentPassword: 'wrong',
        newPassword: 'new-password',
      } as ChangePasswordDto);
      await expect(promise).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', status: 409 });
    });

    it('rotates the hash and revokes all sessions on success', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue({ ...USER, passwordHash: 'stored-hash' });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshSession.updateMany.mockResolvedValue({ count: 2 });
      const passwords = {
        hash: jest.fn().mockResolvedValue('new-hash'),
        verify: jest.fn().mockResolvedValue(true),
      };
      const { svc } = makeService({ prisma, passwords });

      await svc.changePassword('u-1', {
        currentPassword: 'correct',
        newPassword: 'new-password',
      } as ChangePasswordDto);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { passwordHash: 'new-hash' },
      });
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('me', () => {
    it('returns the current user summary', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'a@b.c',
        fullName: 'Alice',
        createdAt: USER.createdAt,
      });
      const { svc } = makeService({ prisma });

      await expect(svc.me('u-1')).resolves.toMatchObject({ id: 'u-1', email: 'a@b.c' });
    });

    it('throws unauthenticated when the user is gone', async () => {
      const prisma = prismaMock();
      prisma.user.findUnique.mockResolvedValue(null);
      const { svc } = makeService({ prisma });

      await expect(svc.me('ghost')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });
});