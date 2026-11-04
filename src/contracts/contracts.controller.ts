import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { ContractStatus, Role } from '../generated/prisma/enums';
import { envelope, parseEnum, parsePage, parseSize, requireExpectedVersion, requireIdempotencyKey } from '../common/http/http-utils';
import { ContractDto } from './dto/contract.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('contracts')
  async list(
    @CurrentMembership() m: MembershipContext,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Query('status') statusRaw: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.contracts.list(m.organizationId, parsePage(pageRaw), parseSize(sizeRaw), parseEnum(ContractStatus, statusRaw)));
  }

  @Post('contracts')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async create(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ContractDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(req, await this.contracts.create(m.organizationId, user.id, dto, key));
  }

  @Get('contracts/:contractId')
  async get(@CurrentMembership() m: MembershipContext, @Param('contractId') contractId: string, @Req() req: RequestWithAuth) {
    return envelope(req, await this.contracts.get(m.organizationId, contractId));
  }

  @Patch('contracts/:contractId')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async update(
    @CurrentMembership() m: MembershipContext,
    @Param('contractId') contractId: string,
    @Headers('X-Expected-Version') versionRaw: string | undefined,
    @Body() dto: ContractDto,
    @Req() req: RequestWithAuth,
  ) {
    const expectedVersion = requireExpectedVersion(versionRaw);
    return envelope(req, await this.contracts.update(m.organizationId, contractId, expectedVersion, dto));
  }

  @Post('contracts/:contractId/activate')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  @HttpCode(HttpStatus.OK)
  async activate(@CurrentMembership() m: MembershipContext, @Param('contractId') contractId: string, @Req() req: RequestWithAuth) {
    return envelope(req, await this.contracts.activate(m.organizationId, contractId));
  }

  @Post('contracts/:contractId/terminate')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  @HttpCode(HttpStatus.OK)
  async terminate(@CurrentMembership() m: MembershipContext, @Param('contractId') contractId: string, @Req() req: RequestWithAuth) {
    return envelope(req, await this.contracts.terminate(m.organizationId, contractId));
  }
}