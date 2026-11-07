import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { Role } from '../generated/prisma/enums';
import { envelope, requireIdempotencyKey } from '../common/http/http-utils';
import { BedAssignmentDto } from './dto/assignment.dto';
import { TransferDto } from './dto/transfer.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post('bed-assignments')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async create(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: BedAssignmentDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(req, await this.assignments.create(m.organizationId, user.id, dto, key));
  }

  @Post('bed-assignments/:assignmentId/end')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  @HttpCode(HttpStatus.OK)
  async end(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(req, await this.assignments.end(m.organizationId, assignmentId, user.id, key));
  }

  @Post('bed-assignments/:assignmentId/transfer')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  @HttpCode(HttpStatus.OK)
  async transfer(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: TransferDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(req, await this.assignments.transfer(m.organizationId, assignmentId, user.id, dto, key));
  }

  @Get('residents/:residentId/assignments')
  async listByResident(@CurrentMembership() m: MembershipContext, @Param('residentId') residentId: string, @Req() req: RequestWithAuth) {
    return envelope(req, await this.assignments.listByResident(m.organizationId, residentId));
  }
}