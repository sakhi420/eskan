import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { LockService } from '../common/concurrency/lock.service';
import { Role } from '../generated/prisma/enums';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

const ORGANIZATION_SELECT = {
  id: true,
  version: true,
  name: true,
  timezone: true,
  defaultCurrency: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface OrganizationRow {
  id: string;
  version: number;
  name: string;
  timezone: string;
  defaultCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

function toOrganizationDto(row: OrganizationRow) {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    timezone: row.timezone,
    defaultCurrency: row.defaultCurrency,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface MembershipRow {
  id: string;
  userId: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  user: { id: string; fullName: string; email: string };
}

function toMembershipDto(row: MembershipRow) {
  return {
    id: row.id,
    userId: row.userId,
    role: row.role,
    active: row.active,
    fullName: row.user.fullName,
    email: row.user.email,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService, private readonly locks: LockService) {}

  async getCurrent(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: ORGANIZATION_SELECT,
    });
    if (!org) throw AppError.notFound('Organization not found');
    return toOrganizationDto(org);
  }

  async updateCurrent(organizationId: string, expectedVersion: number, dto: UpdateOrganizationDto) {
    // Compare-and-swap update: only applies when version still matches.
    const result = await this.prisma.organization.updateMany({
      where: { id: organizationId, version: expectedVersion },
      data: {
        name: dto.name,
        timezone: dto.timezone,
        defaultCurrency: dto.defaultCurrency,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      const exists = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });
      if (!exists) throw AppError.notFound('Organization not found');
      throw AppError.conflict(
        'Organization was modified by another request; refresh and retry',
        ErrorCode.RESOURCE_VERSION_CONFLICT,
      );
    }

    const updated = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: ORGANIZATION_SELECT,
    });
    return toOrganizationDto(updated!);
  }

  async listMembers(organizationId: string) {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
    return rows.map((r) => toMembershipDto(r));
  }

  async updateMember(organizationId: string, membershipId: string, dto: UpdateMemberDto) {
    if (dto.role === undefined && dto.active === undefined) {
      throw AppError.validation('At least one of role or active must be provided', [
        { field: 'role', code: 'invalid', message: 'at least one of role or active is required' },
      ]);
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent membership changes on the organisation row so the
      // "last active owner" check-and-set cannot race (two requests both observe
      // two owners, then both demote/deactivate a different one).
      await this.locks.lockOrganization(tx, organizationId);

      const target = await tx.organizationMembership.findFirst({
        where: { id: membershipId, organizationId },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      });
      if (!target) throw AppError.notFound('Membership not found');

      const nextRole = dto.role ?? target.role;
      const nextActive = dto.active ?? target.active;
      const demotingOwner =
        target.role === Role.OWNER && (nextRole !== Role.OWNER || nextActive === false);

      if (demotingOwner) {
        const owners = await tx.organizationMembership.count({
          where: { organizationId, role: Role.OWNER, active: true },
        });
        if (owners <= 1) {
          throw AppError.conflict(
            'Cannot demote or deactivate the last active owner of the organization',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
      }

      const updated = await tx.organizationMembership.update({
        where: { id: membershipId },
        data: { role: nextRole, active: nextActive },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      });
      return toMembershipDto(updated);
    });
  }
}