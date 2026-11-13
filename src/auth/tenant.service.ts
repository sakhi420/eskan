import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MembershipContext } from './auth.types';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the acting membership. If `organizationId` is provided (from the
   * `X-Organization-Id` selector header) it must be an active membership of the
   * user; otherwise the first active membership is used.
   */
  async resolveActiveMembership(
    userId: string,
    organizationId?: string,
  ): Promise<MembershipContext | null> {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        userId,
        active: true,
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: { organization: { select: { name: true } } },
    });

    if (!membership) return null;
    return this.toContext(membership);
  }

  async listActiveMemberships(userId: string): Promise<MembershipContext[]> {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: 'asc' },
      include: { organization: { select: { name: true } } },
    });
    return rows.map((m) => this.toContext(m));
  }

  private toContext(m: {
    id: string;
    organizationId: string;
    role: MembershipContext['role'];
    active: boolean;
    organization: { name: string };
  }): MembershipContext {
    return {
      membershipId: m.id,
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      role: m.role,
      active: m.active,
    };
  }
}
