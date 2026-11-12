import {
  Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { Role } from '../generated/prisma/enums';
import { envelope, parsePage, parseSize, requireIdempotencyKey } from '../common/http/http-utils';
import { PaymentDto, PaymentRefundDto } from './dto/payment.dto';
import { AllocationReleaseDto, PaymentAllocationDto } from './dto/allocation.dto';
import { ReversalDto } from '../deposits/dto/deposit.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  async list(
    @CurrentMembership() m: MembershipContext,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Query('residentId') residentId: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.payments.listPayments(m.organizationId, parsePage(pageRaw), parseSize(sizeRaw), residentId),
    );
  }

  @Post('payments')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async create(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: PaymentDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.payments.createPayment(m.organizationId, user.id, dto, requireIdempotencyKey(idempotencyKey), req.traceId ?? 'unknown'),
    );
  }

  @Get('payments/:paymentId')
  async get(@CurrentMembership() m: MembershipContext, @Param('paymentId') paymentId: string, @Req() req: RequestWithAuth) {
    return envelope(req, await this.payments.getPayment(m.organizationId, paymentId));
  }

  @Get('residents/:residentId/payments')
  async residentPayments(
    @CurrentMembership() m: MembershipContext,
    @Param('residentId') residentId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.payments.listResidentPayments(m.organizationId, residentId));
  }

  @Get('payments/:paymentId/allocations')
  async listAllocations(
    @CurrentMembership() m: MembershipContext,
    @Param('paymentId') paymentId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.payments.listAllocations(m.organizationId, paymentId));
  }

  @Post('payments/:paymentId/allocations')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async createAllocation(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('paymentId') paymentId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: PaymentAllocationDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.payments.createAllocation(
        m.organizationId,
        user.id,
        paymentId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('allocations/:allocationId/release')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER, Role.ADMIN)
  async release(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('allocationId') allocationId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: AllocationReleaseDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.payments.releaseAllocation(
        m.organizationId,
        user.id,
        allocationId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('payments/:paymentId/refund')
  @Roles(Role.OWNER, Role.ADMIN)
  async refundPayment(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('paymentId') paymentId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: PaymentRefundDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.payments.refundPayment(
        m.organizationId,
        user.id,
        paymentId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('payments/:paymentId/reverse')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER, Role.ADMIN)
  async reversePayment(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('paymentId') paymentId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ReversalDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.payments.reversePayment(
        m.organizationId,
        user.id,
        paymentId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }
}