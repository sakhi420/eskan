import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { Role } from '../generated/prisma/enums';
import { envelope, requireIdempotencyKey } from '../common/http/http-utils';
import {
  DepositApplicationDto,
  DepositCreateDto,
  DepositForfeitDto,
  DepositRefundDto,
  ReversalDto,
} from './dto/deposit.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Get('residents/:residentId/deposit-transactions')
  async listByResident(
    @CurrentMembership() m: MembershipContext,
    @Param('residentId') residentId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.deposits.listByResident(m.organizationId, residentId));
  }

  @Post('residents/:residentId/deposit-transactions')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async create(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('residentId') residentId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: DepositCreateDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.deposits.receive(
        m.organizationId,
        user.id,
        residentId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('residents/:residentId/deposits/apply')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER, Role.ADMIN)
  async apply(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('residentId') residentId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: DepositApplicationDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.deposits.apply(
        m.organizationId,
        user.id,
        residentId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('deposit-transactions/:depositTransactionId/reverse')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER, Role.ADMIN)
  async reverse(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('depositTransactionId') depositTransactionId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ReversalDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.deposits.reverse(
        m.organizationId,
        user.id,
        depositTransactionId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('deposit-transactions/:depositTransactionId/refund')
  @Roles(Role.OWNER, Role.ADMIN)
  async refund(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('depositTransactionId') depositTransactionId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: DepositRefundDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.deposits.refund(
        m.organizationId,
        user.id,
        depositTransactionId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('deposit-transactions/:depositTransactionId/forfeit')
  @Roles(Role.OWNER, Role.ADMIN)
  async forfeit(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('depositTransactionId') depositTransactionId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: DepositForfeitDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.deposits.forfeit(
        m.organizationId,
        user.id,
        depositTransactionId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('deposit-applications/:applicationId/reverse')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER, Role.ADMIN)
  async reverseApplication(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ReversalDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.deposits.reverseApplication(
        m.organizationId,
        user.id,
        applicationId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }
}
