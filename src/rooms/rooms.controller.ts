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
import { RoomsService } from './rooms.service';
import { BedsService } from '../beds/beds.service';
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
import { RoomDto } from './dto/room.dto';
import { BedDto } from '../beds/dto/bed.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly beds: BedsService,
  ) {}

  @Get('hostels/:hostelId/rooms')
  async list(
    @CurrentMembership() membership: MembershipContext,
    @Param('hostelId') hostelId: string,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.rooms.list(
        membership.organizationId,
        hostelId,
        parsePage(pageRaw),
        parseSize(sizeRaw),
      ),
    );
  }

  @Post('hostels/:hostelId/rooms')
  @Roles(Role.OWNER, Role.ADMIN)
  async create(
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('hostelId') hostelId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: RoomDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(
      req,
      await this.rooms.create(membership.organizationId, user.id, hostelId, dto, key),
    );
  }

  @Get('rooms/:roomId')
  async get(
    @CurrentMembership() membership: MembershipContext,
    @Param('roomId') roomId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.rooms.get(membership.organizationId, roomId));
  }

  @Patch('rooms/:roomId')
  @Roles(Role.OWNER, Role.ADMIN)
  async update(
    @CurrentMembership() membership: MembershipContext,
    @Param('roomId') roomId: string,
    @Headers('X-Expected-Version') versionRaw: string | undefined,
    @Body() dto: RoomDto,
    @Req() req: RequestWithAuth,
  ) {
    const expectedVersion = requireExpectedVersion(versionRaw);
    return envelope(
      req,
      await this.rooms.update(membership.organizationId, roomId, expectedVersion, dto),
    );
  }

  @Post('rooms/:roomId/archive')
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentMembership() membership: MembershipContext,
    @Param('roomId') roomId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.rooms.archive(membership.organizationId, roomId));
  }

  @Get('rooms/:roomId/beds')
  async listBeds(
    @CurrentMembership() membership: MembershipContext,
    @Param('roomId') roomId: string,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.beds.listByRoom(
        membership.organizationId,
        roomId,
        parsePage(pageRaw),
        parseSize(sizeRaw),
      ),
    );
  }

  @Post('rooms/:roomId/beds')
  @Roles(Role.OWNER, Role.ADMIN)
  async createBed(
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('roomId') roomId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: BedDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(
      req,
      await this.beds.create(membership.organizationId, user.id, roomId, dto, key),
    );
  }
}
