import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { ArchiveStatus, AssignmentStatus, BedStatus, ContractStatus, MaintenanceStatus, ResidentStatus } from '../generated/prisma/enums';
import { BedAssignmentDto } from './dto/assignment.dto';
import { TransferDto } from './dto/transfer.dto';

const ASSIGNMENT_SELECT = {
  id: true, version: true, organizationId: true, bedId: true, residentId: true, contractId: true,
  status: true, startDate: true, endDate: true, createdAt: true, updatedAt: true,
} as const;

interface AssignmentRow {
  id: string; version: number; organizationId: string; bedId: string; residentId: string; contractId: string;
  status: AssignmentStatus; startDate: Date; endDate: Date | null; createdAt: Date; updatedAt: Date;
}

function toISODate(value: Date | string | null): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
function toDateOnly(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}
function toAssignmentDto(row: AssignmentRow) {
  return {
    id: row.id, version: row.version, organizationId: row.organizationId,
    bedId: row.bedId, residentId: row.residentId, contractId: row.contractId,
    status: row.status, startDate: toISODate(row.startDate), endDate: toISODate(row.endDate),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function dateMs(d: Date | string): number {
  return new Date(d).getTime();
}
function overlapsOver(existing: AssignmentRow[], startDate: string, endDate?: string): boolean {
  const s = dateMs(toDateOnly(startDate));
  const e = endDate ? dateMs(toDateOnly(endDate)) : null;
  return existing.some((a) => {
    const as = dateMs(a.startDate);
    const ae = a.endDate ? dateMs(a.endDate) : null;
    return (ae === null || s < ae) && (e === null || as < e);
  });
}

function isExclusionViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; message?: string };
  const msg = `${e.code ?? ''} ${e.message ?? ''}`;
  return msg.includes('23P01') || /exclusion|no_overlap/i.test(msg);
}

const CREATE_ENDPOINT = '/api/v1/bed-assignments';

@Injectable()
export class AssignmentsService {
  constructor(private readonly prisma: PrismaService, private readonly idempotency: IdempotencyService) {}

  async listByResident(organizationId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({ where: { id: residentId, organizationId }, select: { id: true } });
    if (!resident) throw AppError.notFound('Resident not found');
    const rows = await this.prisma.bedAssignment.findMany({
      where: { organizationId, residentId }, orderBy: { createdAt: 'desc' }, select: ASSIGNMENT_SELECT,
    });
    return rows.map(toAssignmentDto);
  }
async create(organizationId: string, userId: string, dto: BedAssignmentDto, idempotencyKey: string) {
    if (dto.endDate && dto.endDate <= dto.startDate) {
      throw AppError.validation('endDate must be after startDate', [
        { field: 'endDate', code: 'invalid', message: 'must be after startDate' },
      ]);
    }

    const requestHash = this.idempotency.hash(dto);
    // Replay must be checked before any domain reads, so a retry of an already
    // committed request recovers its stored result even if resource statuses
    // have since changed (e.g. the contract was later checked out).
    const replay = await this.idempotency.getReplay<ReturnType<typeof toAssignmentDto>>(
      organizationId, idempotencyKey, CREATE_ENDPOINT, requestHash,
    );
    if (replay) return replay;

    // Fast existence / cross-entity checks (authoritative status checks run in-tx).
    const bed = await this.prisma.bed.findFirst({
      where: { id: dto.bedId, organizationId },
      include: { room: { select: { hostelId: true } } },
    });
    if (!bed) throw AppError.notFound('Bed not found');

    const resident = await this.prisma.resident.findFirst({ where: { id: dto.residentId, organizationId }, select: { id: true } });
    if (!resident) throw AppError.notFound('Resident not found');

    const contract = await this.prisma.stayContract.findFirst({ where: { id: dto.contractId, organizationId }, select: { id: true, residentId: true, hostelId: true } });
    if (!contract) throw AppError.notFound('Contract not found');
    if (contract.residentId !== dto.residentId) {
      throw AppError.conflict('Resident does not match the contract', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (contract.hostelId !== bed.room.hostelId) {
      throw AppError.conflict('Bed does not belong to the contract hostel', ErrorCode.BUSINESS_RULE_VIOLATION);
    }

    return this.idempotency.runAtomic<ReturnType<typeof toAssignmentDto>>(
      { organizationId, key: idempotencyKey, endpoint: CREATE_ENDPOINT, userId, requestHash, statusCode: 201 },
      async (tx) => {
        await this.assertAssignable(tx, organizationId, dto);
        await this.assertNoOverlap(tx, dto.bedId, dto.residentId, dto.startDate, dto.endDate);
        try {
          const assignment = await tx.bedAssignment.create({
            data: {
              organizationId, bedId: dto.bedId, residentId: dto.residentId, contractId: dto.contractId,
              startDate: toDateOnly(dto.startDate), endDate: dto.endDate ? toDateOnly(dto.endDate) : null,
            },
            select: ASSIGNMENT_SELECT,
          });
          return toAssignmentDto(assignment);
        } catch (err) {
          if (isExclusionViolation(err)) {
            throw AppError.conflict('Bed or resident is already assigned within this period', ErrorCode.BED_ASSIGNMENT_OVERLAP);
          }
          throw err;
        }
      },
    );
  }

  /**
   * Authoritative status checks performed inside the transaction so a create
   * cannot race with a concurrent checkout/archive/status transition. The DB
   * exclusion constraints remain the final backstop for overlap.
   */
  private async assertAssignable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    dto: BedAssignmentDto,
  ): Promise<void> {
    const bed = await tx.bed.findFirst({
      where: { id: dto.bedId, organizationId },
      include: {
        room: {
          select: { status: true, maintenanceStatus: true, hostel: { select: { status: true } } },
        },
      },
    });
    if (!bed) throw AppError.notFound('Bed not found');
    if (bed.status !== BedStatus.ACTIVE) throw AppError.conflict('Bed is inactive', ErrorCode.BUSINESS_RULE_VIOLATION);
    if (bed.maintenanceStatus === MaintenanceStatus.OUT_OF_SERVICE || bed.maintenanceStatus === MaintenanceStatus.NEEDS_REPAIR) {
      throw AppError.conflict('Bed is not usable due to its maintenance status', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (bed.room.status === ArchiveStatus.ARCHIVED) {
      throw AppError.conflict('Room is archived; assignment cannot be created', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (bed.room.hostel.status === ArchiveStatus.ARCHIVED) {
      throw AppError.conflict('Hostel is archived; assignment cannot be created', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (bed.room.maintenanceStatus === MaintenanceStatus.OUT_OF_SERVICE || bed.room.maintenanceStatus === MaintenanceStatus.NEEDS_REPAIR) {
      throw AppError.conflict('Room is not usable due to its maintenance status', ErrorCode.BUSINESS_RULE_VIOLATION);
    }

    const resident = await tx.resident.findFirst({ where: { id: dto.residentId, organizationId }, select: { status: true } });
    if (!resident) throw AppError.notFound('Resident not found');
    if (resident.status !== ResidentStatus.ACTIVE) {
      throw AppError.conflict('Resident is not active', ErrorCode.BUSINESS_RULE_VIOLATION);
    }

    const contract = await tx.stayContract.findFirst({
      where: { id: dto.contractId, organizationId },
      select: { status: true, startDate: true, endDate: true },
    });
    if (!contract) throw AppError.notFound('Contract not found');
    if (contract.status !== ContractStatus.ACTIVE) {
      throw AppError.conflict('Contract is not active', ErrorCode.CONTRACT_NOT_ACTIVE);
    }

    // Assignment must fall within the contract's active date range. An open-ended
    // assignment is allowed, but its startDate must not fall after the contract's
    // end date and an explicit endDate must not extend past the contract's end.
    const start = dateMs(toDateOnly(dto.startDate));
    if (start < dateMs(contract.startDate)) {
      throw AppError.conflict('Assignment startDate is before the contract start date', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (contract.endDate) {
      if (start > dateMs(contract.endDate)) {
        throw AppError.conflict('Assignment startDate is after the contract end date', ErrorCode.BUSINESS_RULE_VIOLATION);
      }
      if (dto.endDate != null && dateMs(toDateOnly(dto.endDate)) > dateMs(contract.endDate)) {
        throw AppError.conflict('Assignment extends beyond the contract end date', ErrorCode.BUSINESS_RULE_VIOLATION);
      }
    }
  }

  /**
   * App-level overlap guard (backed by the DB exclusion constraints). Enforces
   * both bed-level availability and the rule that a resident cannot hold two
   * concurrent assignments.
   */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    bedId: string,
    residentId: string,
    startDate: string,
    endDate?: string,
  ): Promise<void> {
    const bedRows = await tx.bedAssignment.findMany({
      where: { bedId, status: AssignmentStatus.ACTIVE },
      select: ASSIGNMENT_SELECT,
    });
    if (overlapsOver(bedRows, startDate, endDate)) {
      throw AppError.conflict('Bed is already assigned within this period', ErrorCode.BED_ASSIGNMENT_OVERLAP);
    }

    const residentRows = await tx.bedAssignment.findMany({
      where: { residentId, status: AssignmentStatus.ACTIVE },
      select: ASSIGNMENT_SELECT,
    });
    if (overlapsOver(residentRows, startDate, endDate)) {
      throw AppError.conflict('Resident already has an assignment within this period', ErrorCode.BED_ASSIGNMENT_OVERLAP);
    }
  }

  async end(organizationId: string, assignmentId: string) {
    const result = await this.prisma.bedAssignment.updateMany({
      where: { id: assignmentId, organizationId, status: AssignmentStatus.ACTIVE },
      data: { status: AssignmentStatus.ENDED, endDate: new Date(), version: { increment: 1 } },
    });
    if (result.count === 0) {
      const existing = await this.prisma.bedAssignment.findFirst({ where: { id: assignmentId, organizationId }, select: ASSIGNMENT_SELECT });
      if (!existing) throw AppError.notFound('Assignment not found');
      return toAssignmentDto(existing); // already ended — idempotent
    }
    const updated = await this.prisma.bedAssignment.findFirst({ where: { id: assignmentId, organizationId }, select: ASSIGNMENT_SELECT });
    return toAssignmentDto(updated!);
  }

  /**
   * Transfer: atomically end the current assignment and start a new one on a
   * different bed, preserving the outgoing assignment as history.
   */
  async transfer(organizationId: string, assignmentId: string, userId: string, dto: TransferDto, idempotencyKey: string) {
    if (dto.endDate && dto.endDate <= dto.startDate) {
      throw AppError.validation('endDate must be after startDate', [
        { field: 'endDate', code: 'invalid', message: 'must be after startDate' },
      ]);
    }

    const endpoint = `/api/v1/bed-assignments/${assignmentId}/transfer`;
    const requestHash = this.idempotency.hash(dto);

    return this.idempotency.runAtomic<{ previous: ReturnType<typeof toAssignmentDto>; assignment: ReturnType<typeof toAssignmentDto> }>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 200 },
      async (tx) => {
        const current = await tx.bedAssignment.findFirst({
          where: { id: assignmentId, organizationId },
          select: ASSIGNMENT_SELECT,
        });
        if (!current) throw AppError.notFound('Assignment not found');
        if (current.status === AssignmentStatus.ENDED) {
          throw AppError.conflict('Assignment has already ended', ErrorCode.BUSINESS_RULE_VIOLATION);
        }
        if (dto.bedId === current.bedId) {
          throw AppError.conflict('Cannot transfer to the same bed', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const transitionStart = toDateOnly(dto.startDate);
        if (dateMs(transitionStart) < dateMs(current.startDate)) {
          throw AppError.conflict('Transfer startDate cannot be before the current assignment start date', ErrorCode.BUSINESS_RULE_VIOLATION);
        }
        if (current.endDate && dateMs(transitionStart) > dateMs(current.endDate)) {
          throw AppError.conflict('Transfer startDate cannot be after the current assignment end date', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const bed = await tx.bed.findFirst({
          where: { id: dto.bedId, organizationId },
          include: {
            room: {
              select: {
                hostelId: true,
                status: true,
                maintenanceStatus: true,
                hostel: { select: { status: true } },
              },
            },
          },
        });
        if (!bed) throw AppError.notFound('Bed not found');
        if (bed.status !== BedStatus.ACTIVE) throw AppError.conflict('Bed is inactive', ErrorCode.BUSINESS_RULE_VIOLATION);
        if (bed.maintenanceStatus === MaintenanceStatus.OUT_OF_SERVICE || bed.maintenanceStatus === MaintenanceStatus.NEEDS_REPAIR) {
          throw AppError.conflict('Destination bed is not usable due to its maintenance status', ErrorCode.BUSINESS_RULE_VIOLATION);
        }
        if (bed.room.status === ArchiveStatus.ARCHIVED) throw AppError.conflict('Destination room is archived', ErrorCode.BUSINESS_RULE_VIOLATION);
        if (bed.room.hostel.status === ArchiveStatus.ARCHIVED) throw AppError.conflict('Destination hostel is archived', ErrorCode.BUSINESS_RULE_VIOLATION);
        if (bed.room.maintenanceStatus === MaintenanceStatus.OUT_OF_SERVICE || bed.room.maintenanceStatus === MaintenanceStatus.NEEDS_REPAIR) {
          throw AppError.conflict('Destination room is not usable due to its maintenance status', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const contract = await tx.stayContract.findFirst({
          where: { id: current.contractId, organizationId },
          select: { hostelId: true, status: true, startDate: true, endDate: true },
        });
        if (!contract) throw AppError.notFound('Contract not found');
        if (contract.status !== ContractStatus.ACTIVE) {
          throw AppError.conflict('Contract is not active', ErrorCode.CONTRACT_NOT_ACTIVE);
        }
        if (contract.hostelId !== bed.room.hostelId) {
          throw AppError.conflict('New bed does not belong to the contract hostel', ErrorCode.BUSINESS_RULE_VIOLATION);
        }
        if (dateMs(transitionStart) < dateMs(contract.startDate)) {
          throw AppError.conflict('Transfer startDate is before the contract start date', ErrorCode.BUSINESS_RULE_VIOLATION);
        }
        if (contract.endDate && dateMs(transitionStart) > dateMs(contract.endDate)) {
          throw AppError.conflict('Transfer startDate is after the contract end date', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

      // CAS: end the current assignment only if still ACTIVE and unmodified.
        const endedResult = await tx.bedAssignment.updateMany({
          where: { id: assignmentId, organizationId, status: AssignmentStatus.ACTIVE, version: current.version },
          data: { status: AssignmentStatus.ENDED, endDate: transitionStart, version: { increment: 1 } },
        });
        if (endedResult.count === 0) {
          throw AppError.conflict('Assignment was modified concurrently; refresh and retry', ErrorCode.RESOURCE_VERSION_CONFLICT);
        }
        const ended = await tx.bedAssignment.findUnique({ where: { id: assignmentId }, select: ASSIGNMENT_SELECT });

        const existing = await tx.bedAssignment.findMany({
          where: { bedId: dto.bedId, status: AssignmentStatus.ACTIVE },
          select: ASSIGNMENT_SELECT,
        });
        if (overlapsOver(existing, dto.startDate, dto.endDate)) {
          throw AppError.conflict('Destination bed is already assigned within this period', ErrorCode.BED_ASSIGNMENT_OVERLAP);
        }

        try {
          const created = await tx.bedAssignment.create({
            data: {
              organizationId, bedId: dto.bedId, residentId: current.residentId, contractId: current.contractId,
              startDate: transitionStart, endDate: dto.endDate ? toDateOnly(dto.endDate) : null,
            },
            select: ASSIGNMENT_SELECT,
          });
          return { previous: toAssignmentDto(ended!), assignment: toAssignmentDto(created) };
        } catch (err) {
          if (isExclusionViolation(err)) {
            throw AppError.conflict('Destination bed is already assigned within this period', ErrorCode.BED_ASSIGNMENT_OVERLAP);
          }
          throw err;
        }
      },
    );
  }
}