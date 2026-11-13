import { Body, Controller, Get, Headers, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { Role } from '../generated/prisma/enums';
import { envelope, requireExpectedVersion } from '../common/http/http-utils';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@Controller('organizations')
@UseGuards(TenantGuard, RolesGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('current')
  async current(@CurrentMembership() membership: MembershipContext, @Req() req: RequestWithAuth) {
    return envelope(req, await this.organizations.getCurrent(membership.organizationId));
  }

  @Patch('current')
  @Roles(Role.OWNER)
  async updateCurrent(
    @CurrentMembership() membership: MembershipContext,
    @Headers('X-Expected-Version') versionRaw: string | undefined,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: RequestWithAuth,
  ) {
    const expectedVersion = requireExpectedVersion(versionRaw);
    return envelope(
      req,
      await this.organizations.updateCurrent(membership.organizationId, expectedVersion, dto),
    );
  }

  @Get('current/members')
  async members(@CurrentMembership() membership: MembershipContext, @Req() req: RequestWithAuth) {
    return envelope(req, await this.organizations.listMembers(membership.organizationId));
  }

  @Patch('current/members/:membershipId')
  @Roles(Role.OWNER)
  async updateMember(
    @CurrentMembership() membership: MembershipContext,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateMemberDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.organizations.updateMember(membership.organizationId, membershipId, dto),
    );
  }
}
