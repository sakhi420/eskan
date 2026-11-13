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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PackagesService } from './packages.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { Role } from '../generated/prisma/enums';
import {
  envelope,
  parsePage,
  parseSize,
  requireExpectedVersion,
  requireIdempotencyKey,
} from '../common/http/http-utils';
import { PackageDto } from './dto/package.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get('hostels/:hostelId/packages')
  async list(
    @CurrentMembership() membership: MembershipContext,
    @Param('hostelId') hostelId: string,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.packages.list(
        membership.organizationId,
        hostelId,
        parsePage(pageRaw),
        parseSize(sizeRaw),
      ),
    );
  }

  @Post('hostels/:hostelId/packages')
  @Roles(Role.OWNER, Role.ADMIN)
  async create(
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('hostelId') hostelId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: PackageDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(
      req,
      await this.packages.create(membership.organizationId, user.id, hostelId, dto, key),
    );
  }

  @Get('packages/:packageId')
  async get(
    @CurrentMembership() membership: MembershipContext,
    @Param('packageId') packageId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.packages.get(membership.organizationId, packageId));
  }

  @Patch('packages/:packageId')
  @Roles(Role.OWNER, Role.ADMIN)
  async update(
    @CurrentMembership() membership: MembershipContext,
    @Param('packageId') packageId: string,
    @Headers('X-Expected-Version') versionRaw: string | undefined,
    @Body() dto: PackageDto,
    @Req() req: RequestWithAuth,
  ) {
    const expectedVersion = requireExpectedVersion(versionRaw);
    return envelope(
      req,
      await this.packages.update(membership.organizationId, packageId, expectedVersion, dto),
    );
  }

  @Post('packages/:packageId/archive')
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentMembership() membership: MembershipContext,
    @Param('packageId') packageId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.packages.archive(membership.organizationId, packageId));
  }
}
