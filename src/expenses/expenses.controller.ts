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
import { ExpensesService } from './expenses.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { Role } from '../generated/prisma/enums';
import { envelope, parsePage, parseSize, requireIdempotencyKey } from '../common/http/http-utils';
import { ExpenseCreateDto } from './dto/expense.dto';
import { ReversalDto } from '../deposits/dto/deposit.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('expenses')
  async list(
    @CurrentMembership() m: MembershipContext,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.expenses.list(m.organizationId, parsePage(pageRaw), parseSize(sizeRaw)),
    );
  }

  @Post('expenses')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async create(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ExpenseCreateDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.expenses.create(
        m.organizationId,
        user.id,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }

  @Get('expenses/:expenseId')
  async get(
    @CurrentMembership() m: MembershipContext,
    @Param('expenseId') expenseId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.expenses.get(m.organizationId, expenseId));
  }

  @Post('expenses/:expenseId/reverse')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER, Role.ADMIN)
  async reverse(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('expenseId') expenseId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ReversalDto,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.expenses.reverse(
        m.organizationId,
        user.id,
        expenseId,
        dto,
        requireIdempotencyKey(idempotencyKey),
        req.traceId ?? 'unknown',
      ),
    );
  }
}
