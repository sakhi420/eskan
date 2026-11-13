import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChargesService } from './charges.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { ChargeType, EntrySide, Role } from '../generated/prisma/enums';
import { AppError } from '../common/errors/app-error';
import {
  envelope,
  parseEnum,
  parsePage,
  parseSize,
  requireIdempotencyKey,
} from '../common/http/http-utils';
import { ChargeDto } from './dto/charge.dto';
import { BillingPostRequestDto, BillingPreviewRequestDto } from './dto/billing.dto';
import { ReversalDto } from '../deposits/dto/deposit.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  @Get('charges')
  async list(
    @CurrentMembership() m: MembershipContext,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Query('residentId') residentId: string | undefined,
    @Query('type') typeRaw: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.charges.listCharges(
        m.organizationId,
        parsePage(pageRaw),
        parseSize(sizeRaw),
        residentId,
        parseEnum(ChargeType, typeRaw),
      ),
    );
  }

  @Post('charges')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async create(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ChargeDto,
    @Req() req: RequestWithAuth,
  ) {
    if (
      (dto.entrySide ?? EntrySide.DEBIT) === EntrySide.CREDIT &&
      m.role !== Role.OWNER &&
      m.role !== Role.ADMIN
    ) {
      throw AppError.forbidden('Only OWNER or ADMIN can post credits');
    }
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(
      req,
      await this.charges.createCharge(
        m.organizationId,
        user.id,
        dto,
        key,
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Get('charges/:chargeId')
  async get(
    @CurrentMembership() m: MembershipContext,
    @Param('chargeId') chargeId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.charges.getCharge(m.organizationId, chargeId));
  }

  @Post('charges/:chargeId/reverse')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER, Role.ADMIN)
  async reverse(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('chargeId') chargeId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ReversalDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.charges.reverseCharge(
        m.organizationId,
        user.id,
        chargeId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Post('billing-runs/preview')
  async preview(
    @CurrentMembership() m: MembershipContext,
    @Body() dto: BillingPreviewRequestDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.charges.previewBilling(m.organizationId, dto));
  }

  @Post('billing-runs')
  @Roles(Role.OWNER, Role.ADMIN)
  async postBilling(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: BillingPostRequestDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(
      req,
      await this.charges.postBilling(m.organizationId, user.id, dto, key, req.traceId ?? 'unknown'),
    );
  }

  @Post('absences/:absenceId/credits')
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async generateAbsenceCredits(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('absenceId') absenceId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(
      req,
      await this.charges.generateAbsenceCredits(
        m.organizationId,
        user.id,
        absenceId,
        key,
        req.traceId ?? 'unknown',
      ),
    );
  }
}
