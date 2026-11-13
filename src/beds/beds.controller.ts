import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BedsService } from './beds.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { Role } from '../generated/prisma/enums';
import { envelope, requireExpectedVersion } from '../common/http/http-utils';
import { BedDto } from './dto/bed.dto';

@Controller('beds')
@UseGuards(TenantGuard, RolesGuard)
export class BedsController {
  constructor(private readonly beds: BedsService) {}

  @Get(':bedId')
  async get(
    @CurrentMembership() membership: MembershipContext,
    @Param('bedId') bedId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.beds.get(membership.organizationId, bedId));
  }

  @Patch(':bedId')
  @Roles(Role.OWNER, Role.ADMIN)
  async update(
    @CurrentMembership() membership: MembershipContext,
    @Param('bedId') bedId: string,
    @Headers('X-Expected-Version') versionRaw: string | undefined,
    @Body() dto: BedDto,
    @Req() req: RequestWithAuth,
  ) {
    const expectedVersion = requireExpectedVersion(versionRaw);
    return envelope(
      req,
      await this.beds.update(membership.organizationId, bedId, expectedVersion, dto),
    );
  }

  @Post(':bedId/deactivate')
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @CurrentMembership() membership: MembershipContext,
    @Param('bedId') bedId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.beds.deactivate(membership.organizationId, bedId));
  }
}
