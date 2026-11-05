import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { MembershipContext } from './auth.types';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TenantService } from './tenant.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
  createdAt: Date;
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserSummary;
  memberships: MembershipContext[];
}

@Injectable()
export class AuthService {
  private dummyHashPromise?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly tenants: TenantService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, traceId: string): Promise<AuthSession> {
    if (!this.config.get<boolean>('auth.registrationEnabled')) {
      throw AppError.forbidden('Registration is disabled', 'REGISTRATION_DISABLED');
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw AppError.conflict('An account with this email already exists');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const trialDays = this.config.get<number>('trialDays') ?? 30;
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const user = await this.prisma.$transaction(async (tx) => {
      const free = await tx.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
      if (!free) {
        throw AppError.conflict('Subscription plans are not seeded (FREE plan missing)');
      }

      const createdUser = await tx.user.create({
        data: { email, passwordHash, fullName: dto.fullName.trim() },
      });

      const org = await tx.organization.create({
        data: {
          name: dto.organizationName.trim(),
          memberships: { create: { userId: createdUser.id, role: 'OWNER' } },
        },
      });

      await tx.organizationSubscription.create({
        data: {
          organizationId: org.id,
          planId: free.id,
          status: 'TRIALING',
          trialStartsAt: now,
          trialEndsAt,
        },
      });

      await tx.subscriptionEvent.create({
        data: {
          organizationId: org.id,
          actorUserId: createdUser.id,
          action: 'TRIAL_STARTED',
          traceId,
          after: {
            status: 'TRIALING',
            planCode: free.code,
            trialEndsAt: trialEndsAt.toISOString(),
          },
        },
      });

      return createdUser;
    });

    return this.buildSession(user);
  }

  async login(dto: LoginDto): Promise<AuthSession> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Mitigate timing side channel: run an Argon2 verify even when the
      // account does not exist, so the response is not trivially faster.
      await this.passwords.verify(await this.dummyHash(), dto.password);
      throw AppError.unauthorized('Invalid email or password');
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw AppError.unauthorized('Invalid email or password');
    }

    return this.buildSession(user);
  }

  async refresh(dto: RefreshDto): Promise<AuthSession> {
    const tokenHash = this.tokens.hashToken(dto.refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) {
      throw AppError.unauthorized('Invalid refresh token');
    }

    // Reuse detection: a token whose session was already rotated (or revoked)
    // is presented again -> assume compromise and revoke the whole family.
    if (session.replacedById !== null || session.revokedAt !== null) {
      await this.revokeFamily(session.userId, session.family);
      throw AppError.unauthorized('Refresh token has been reused and was revoked');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw AppError.unauthorized('Refresh token has expired');
    }

    const { raw, hash } = this.tokens.generateRefreshToken();
    const now = new Date();

    // Rotate atomically: generate one token, persist it in the SAME family as
    // the rotated session, and link old -> new. The compare-and-swap ensures
    // only one of two concurrent refresh calls wins. The winner returns `raw`;
    // the loser is a legitimate concurrent request (not proven reuse), so we
    // reject it WITHOUT revoking the family — revoking would log out the very
    // client that just won. Genuine later reuse of the already-rotated token is
    // still caught by the pre-check above (which revokes the family).
    const rotated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshSession.updateMany({
        where: {
          id: session.id,
          replacedById: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      if (claimed.count === 0) return false;

      const next = await tx.refreshSession.create({
        data: {
          userId: session.userId,
          family: session.family,
          tokenHash: hash,
          expiresAt: this.tokens.refreshExpiresAt(),
        },
      });
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { replacedById: next.id },
      });
      return true;
    });

    if (!rotated) {
      throw AppError.unauthorized('Refresh token rotation conflict; retry with the new token');
    }

    const payload = await this.buildSessionPayload(session.user);
    return { ...payload, refreshToken: raw };
  }

  async logout(userId: string, dto: RefreshDto): Promise<void> {
    const tokenHash = this.tokens.hashToken(dto.refreshToken);
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash } });
    if (!session || session.revokedAt !== null) return;

    if (session.userId !== userId) {
      throw AppError.forbidden('Refresh token does not belong to the authenticated user');
    }

    await this.revokeFamily(session.userId, session.family);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<UserSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, createdAt: true },
    });
    if (!user) throw AppError.unauthorized();
    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.unauthorized();

    const valid = await this.passwords.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw AppError.conflict('Current password is incorrect');
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async buildSessionPayload(user: UserRecord): Promise<Omit<AuthSession, 'refreshToken'>> {
    const memberships = await this.tenants.listActiveMemberships(user.id);
    const { token: accessToken, expiresIn } = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
    });

    return {
      accessToken,
      expiresIn,
      user: { id: user.id, email: user.email, fullName: user.fullName, createdAt: user.createdAt },
      memberships,
    };
  }

  private async buildSession(user: UserRecord): Promise<AuthSession> {
    const payload = await this.buildSessionPayload(user);
    const { raw, hash } = this.tokens.generateRefreshToken();
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        family: randomUUID(),
        tokenHash: hash,
        expiresAt: this.tokens.refreshExpiresAt(),
      },
    });
    return { ...payload, refreshToken: raw };
  }

  private async revokeFamily(userId: string, family: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private dummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = this.passwords.hash('eskan-timing-mitigation');
    }
    return this.dummyHashPromise;
  }
}