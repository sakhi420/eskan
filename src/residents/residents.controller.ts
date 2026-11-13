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
import { ResidentsService } from './residents.service';
import { ContractsService } from '../contracts/contracts.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, MembershipContext, RequestWithAuth } from '../auth/auth.types';
import { ResidentStatus, ResidentType, Role } from '../generated/prisma/enums';
import {
  envelope,
  parseEnum,
  parsePage,
  parseSize,
  requireExpectedVersion,
  requireIdempotencyKey,
} from '../common/http/http-utils';
import { ResidentDto } from './dto/resident.dto';

@Controller()
@UseGuards(TenantGuard, RolesGuard)
export class ResidentsController {
  constructor(
    private readonly residents: ResidentsService,
    private readonly contracts: ContractsService,
    private readonly assignments: AssignmentsService,
  ) {}

  @Get('residents')
  async list(
    @CurrentMembership() m: MembershipContext,
    @Query('page') pageRaw: string | undefined,
    @Query('size') sizeRaw: string | undefined,
    @Query('q') q: string | undefined,
    @Query('type') typeRaw: string | undefined,
    @Query('status') statusRaw: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(
      req,
      await this.residents.list(
        m.organizationId,
        parsePage(pageRaw),
        parseSize(sizeRaw),
        q,
        parseEnum(ResidentType, typeRaw),
        parseEnum(ResidentStatus, statusRaw),
      ),
    );
  }

  @Post('residents')
  @Roles(Role.OWNER, Role.ADMIN, Role.OPERATOR)
  async create(
    @CurrentMembership() m: MembershipContext,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: ResidentDto,
    @Req() req: RequestWithAuth,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return envelope(req, await this.residents.create(m.organizationId, user.id, dto, key));
  }

  @Get('residents/:residentId')
  async get(
    @CurrentMembership() m: MembershipContext,
    @Param('residentId') residentId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.residents.get(m.organizationId, residentId));
  }

  @Patch('residents/:residentId')
  @Roles(Role.OWNER, Role.ADMIN)
  async update(
    @CurrentMembership() m: MembershipContext,
    @Param('residentId') residentId: string,
    @Headers('X-Expected-Version') versionRaw: string | undefined,
    @Body() dto: ResidentDto,
    @Req() req: RequestWithAuth,
  ) {
    const expectedVersion = requireExpectedVersion(versionRaw);
    return envelope(
      req,
      await this.residents.update(m.organizationId, residentId, expectedVersion, dto),
    );
  }

  @Post('residents/:residentId/archive')
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentMembership() m: MembershipContext,
    @Param('residentId') residentId: string,
    @Req() req: RequestWithAuth,
  ) {
    return envelope(req, await this.residents.archive(m.organizationId, residentId));
  }

  @Get('residents/:residentId/timeline')
  async timeline(
    @CurrentMembership() m: MembershipContext,
    @Param('residentId') residentId: string,
    @Req() req: RequestWithAuth,
  ) {
    await this.residents.get(m.organizationId, residentId);
    const [contracts, assignments] = await Promise.all([
      this.contracts.listByResident(m.organizationId, residentId),
      this.assignments.listByResident(m.organizationId, residentId),
    ]);
    return envelope(req, { residentId, contracts, assignments });
  }
}
