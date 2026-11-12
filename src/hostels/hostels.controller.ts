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
import { HostelsService } from './hostels.service';
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
import { HostelDto } from './dto/hostel.dto';

@Controller('hostels')
@UseGuards(TenantGuard, RolesGuard)
export class HostelsController {
  constructor(private readonly hostels: HostelsService) {}

  @Get()
  async list(
    @CurrentMembership() membership: MembershipContext,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Query('q') q: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    const page = parsePage(pageRaw);
    const size = parseSize(sizeRaw);
    return envelope(req, await this.hostels.list(membership.organizationId, page, size, q));
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async create(
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: HostelDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(req, await this.hostels.create(membership.organizationId, user.id, dto, key));
  }

  @Get(':hostelId')
  async get(
    @CurrentMembership() membership: MembershipContext,
    @Param('hostelId') hostelId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.hostels.get(membership.organizationId, hostelId));
  }

  @Patch(':hostelId')
  @Roles(Role.OWNER, Role.ADMIN)
  async update(
    @CurrentMembership() membership: MembershipContext,
    @Param('hostelId') hostelId: string,
    @Headers('X-Expected-Version') versionRaw: string | undefined,
    @Body() dto: HostelDto,
    @Req() req: RequestWithAuth,
  ) {
    const expectedVersion = requireExpectedVersion(versionRaw);
    return envelope(
      req,
      await this.hostels.update(membership.organizationId, hostelId, expectedVersion, dto),
    );
  }

  @Post(':hostelId/archive')
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentMembership() membership: MembershipContext,
    @Param('hostelId') hostelId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.hostels.archive(membership.organizationId, hostelId));
  }
}
