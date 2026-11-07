import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { LockService } from '../common/concurrency/lock.service';
import { businessTodayForOrg, exclusiveEndForInclusiveLastDay, toDateOnly as toBusinessDateOnly } from '../common/date/business-date';
import { ArchiveStatus, AssignmentEndReason, AssignmentStatus, BedStatus, ContractStatus, MaintenanceStatus, ResidentStatus } from '../generated/prisma/enums';
import { BedAssignmentDto } from './dto/assignment.dto';
import { TransferDto } from './dto/transfer.dto';

const ASSIGNMENT_SELECT = {
  id: true, version: true, organizationId: true, bedId: true, residentId: true, contractId: true,
  status: true, startDate: true, endDate: true, endReason: true, createdAt: true, updatedAt: true,
} as const;

interface AssignmentRow {
  id: string; version: number; organizationId: string; bedId: string; residentId: string; contractId: string;
  status: AssignmentStatus; startDate: Date; endDate: Date | null; endReason: AssignmentEndReason | null; createdAt: Date; updatedAt: Date;
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
    status: row.status, startDate: toISODate(row.startDate), endDate: toISODate(row.endDate), endReason: row.endReason,
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

/**
 * Asserts that a proposed `[start, end)` assignment/transfer range falls inside
 * a contract's half-open `[contractStart, contractEnd)` range. `end === null`
 * means open-ended (allowed up to, but not including, the contract end).
 */
function assertRangeWithinContract(
  start: Date,
  end: Date | null,
  contractStart: Date,
  contractEnd: Date | null,
  label: string,
): void {
  const s = start.getTime();
  if (s < contractStart.getTime()) {
    throw AppError.conflict(`${label} startDate is before the contract start date`, ErrorCode.BUSINESS_RULE_VIOLATION);
  }
  if (contractEnd) {
    const ce = contractEnd.getTime();
    if (s >= ce) {
      throw AppError.conflict(`${label} startDate is on or after the contract end date`, ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (end && end.getTime() > ce) {
      throw AppError.conflict(`${label} extends beyond the contract end date`, ErrorCode.BUSINESS_RULE_VIOLATION);
    }
  }
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly locks: LockService,
  ) {}

  /**
   * Acquires the parent-chain locks in the canonical global order
   * (Hostel -> Room -> Bed -> Resident -> Contract) so a concurrent archive,
   * checkout or terminate -- which also locks these rows -- serializes before
   * this assignment is committed.
   */
  private async lockCreateContext(
    tx: Prisma.TransactionClient,
    organizationId: string,
    bedId: string,
    residentId: string,
    contractId: string,
  ): Promise<void> {
    const bed = await tx.bed.findFirst({
      where: { id: bedId, organizationId },
      select: { roomId: true, room: { select: { hostelId: true } } },
    });
    if (!bed) throw AppError.notFound('Bed not found');
    await this.locks.lockHostel(tx, bed.room.hostelId);
    await this.locks.lockRoom(tx, bed.roomId);
    await this.locks.lockBed(tx, bedId);
    await this.locks.lockResident(tx, residentId);
    await this.locks.lockContract(tx, contractId);
  }

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
        await this.lockCreateContext(tx, organizationId, dto.bedId, dto.residentId, dto.contractId);
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

    // Assignment must fall within the contract's half-open [startDate, endDate).
    // An open-ended assignment is allowed, but its startDate must not be on/after
    // the contract end and an explicit endDate must not extend past the contract.
    assertRangeWithinContract(
      toDateOnly(dto.startDate),
      dto.endDate ? toDateOnly(dto.endDate) : null,
      contract.startDate,
      contract.endDate,
      'Assignment',
    );
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

  async end(organizationId: string, assignmentId: string, userId: string, idempotencyKey: string) {
    const endpoint = `/api/v1/bed-assignments/${assignmentId}/end`;
    const requestHash = this.idempotency.hash({ assignmentId });
    return this.idempotency.runAtomic<ReturnType<typeof toAssignmentDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 200 },
      async (tx) => {
        const assignment = await tx.bedAssignment.findFirst({
          where: { id: assignmentId, organizationId },
          select: ASSIGNMENT_SELECT,
        });
        if (!assignment) throw AppError.notFound('Assignment not found');
        if (assignment.status === AssignmentStatus.ENDED) return toAssignmentDto(assignment); // idempotent

        // Serialize against a concurrent checkout/transfer by taking the same
        // parent chain (Hostel -> Room -> Bed -> Resident -> Contract): both lock
        // the contract, so a manual end and a checkout cannot interleave.
        await this.lockCreateContext(tx, organizationId, assignment.bedId, assignment.residentId, assignment.contractId);

        // Authoritative re-read AFTER acquiring the locks.
        const current = await tx.bedAssignment.findFirst({
          where: { id: assignmentId, organizationId },
          select: ASSIGNMENT_SELECT,
        });
        if (!current) throw AppError.notFound('Assignment not found');
        if (current.status === AssignmentStatus.ENDED) return toAssignmentDto(current);

        // The end date is a business date in the org's timezone, never `new Date()`
        // (which would truncate inconsistently and could even land on the start date).
        const today = await businessTodayForOrg(tx, organizationId);
        const startDate = toISODate(current.startDate);
        if (!startDate) {
          throw AppError.conflict('Assignment is missing its start date', ErrorCode.BUSINESS_RULE_VIOLATION);
        }
        // Same-day end is valid: endDate is exclusive, so ending on the start day
        // yields endDate = startDay + 1. Only ending strictly before the start is
        // rejected.
        if (today < startDate) {
          throw AppError.conflict(
            'Assignment cannot be ended before its start date',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
        const exclusiveEnd = exclusiveEndForInclusiveLastDay(today);

        const result = await tx.bedAssignment.updateMany({
          where: { id: assignmentId, organizationId, status: AssignmentStatus.ACTIVE, version: current.version },
          data: {
            status: AssignmentStatus.ENDED,
            endDate: toBusinessDateOnly(exclusiveEnd),
            endReason: AssignmentEndReason.MANUAL_END,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw AppError.conflict('Assignment was modified concurrently; refresh and retry', ErrorCode.RESOURCE_VERSION_CONFLICT);
        }
        const updated = await tx.bedAssignment.findFirst({ where: { id: assignmentId, organizationId }, select: ASSIGNMENT_SELECT });
        return toAssignmentDto(updated!);
      },
    );
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
        if (dateMs(transitionStart) <= dateMs(current.startDate)) {
          throw AppError.conflict('Transfer startDate must be after the current assignment start date', ErrorCode.BUSINESS_RULE_VIOLATION);
        }
        if (current.endDate && dateMs(transitionStart) > dateMs(current.endDate)) {
          throw AppError.conflict('Transfer startDate cannot be after the current assignment end date', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        // Discover destination parents for lock order, then re-read the bed
        // AFTER locking so status decisions never use a pre-lock snapshot.
        const dest = await tx.bed.findFirst({
          where: { id: dto.bedId, organizationId },
          select: { roomId: true, room: { select: { hostelId: true } } },
        });
        if (!dest) throw AppError.notFound('Bed not found');

        // Serialize against concurrent archive/checkout/terminate before any
        // status re-check. Lock order: Hostel -> Room -> Bed -> Resident -> Contract.
        await this.locks.lockHostel(tx, dest.room.hostelId);
        await this.locks.lockRoom(tx, dest.roomId);
        await this.locks.lockBed(tx, dto.bedId);
        await this.locks.lockResident(tx, current.residentId);
        await this.locks.lockContract(tx, current.contractId);

        // Authoritative destination re-read after acquiring the locks.
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

        // Transfer range (including any explicit new endDate) must stay within
        // the contract's half-open [startDate, endDate) window.
        assertRangeWithinContract(
          transitionStart,
          dto.endDate ? toDateOnly(dto.endDate) : null,
          contract.startDate,
          contract.endDate,
          'Transfer',
        );

      // CAS: end the current assignment only if still ACTIVE and unmodified.
        const endedResult = await tx.bedAssignment.updateMany({
          where: { id: assignmentId, organizationId, status: AssignmentStatus.ACTIVE, version: current.version },
          data: { status: AssignmentStatus.ENDED, endDate: transitionStart, endReason: AssignmentEndReason.TRANSFER, version: { increment: 1 } },
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