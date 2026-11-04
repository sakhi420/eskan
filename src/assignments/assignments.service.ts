import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { AssignmentStatus, BedStatus, ContractStatus, MaintenanceStatus } from '../generated/prisma/enums';
import { BedAssignmentDto } from './dto/assignment.dto';

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

    const bed = await this.prisma.bed.findFirst({
      where: { id: dto.bedId, organizationId },
      include: { room: { select: { hostelId: true } } },
    });
    if (!bed) throw AppError.notFound('Bed not found');
    if (bed.status !== BedStatus.ACTIVE) {
      throw AppError.conflict('Bed is inactive', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (bed.maintenanceStatus === MaintenanceStatus.OUT_OF_SERVICE || bed.maintenanceStatus === MaintenanceStatus.NEEDS_REPAIR) {
      throw AppError.conflict('Bed is not usable due to its maintenance status', ErrorCode.BUSINESS_RULE_VIOLATION);
    }

    const resident = await this.prisma.resident.findFirst({ where: { id: dto.residentId, organizationId }, select: { id: true } });
    if (!resident) throw AppError.notFound('Resident not found');

    const contract = await this.prisma.stayContract.findFirst({
      where: { id: dto.contractId, organizationId },
      select: { id: true, residentId: true, hostelId: true, status: true },
    });
    if (!contract) throw AppError.notFound('Contract not found');
    if (contract.status !== ContractStatus.ACTIVE) {
      throw AppError.conflict('Contract is not active', ErrorCode.CONTRACT_NOT_ACTIVE);
    }
    if (contract.residentId !== dto.residentId) {
      throw AppError.conflict('Resident does not match the contract', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (contract.hostelId !== bed.room.hostelId) {
      throw AppError.conflict('Bed does not belong to the contract hostel', ErrorCode.BUSINESS_RULE_VIOLATION);
    }

    const requestHash = this.idempotency.hash(dto);
    const replay = await this.idempotency.getReplay<ReturnType<typeof toAssignmentDto>>(organizationId, idempotencyKey, CREATE_ENDPOINT, requestHash);
    if (replay) return replay;

    try {
      const assignment = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.bedAssignment.findMany({
          where: { bedId: dto.bedId, status: AssignmentStatus.ACTIVE }, select: ASSIGNMENT_SELECT,
        });
        if (overlapsOver(existing, dto.startDate, dto.endDate)) {
          throw AppError.conflict('Bed is already assigned within this period', ErrorCode.BED_ASSIGNMENT_OVERLAP);
        }
        return tx.bedAssignment.create({
          data: {
            organizationId, bedId: dto.bedId, residentId: dto.residentId, contractId: dto.contractId,
            startDate: toDateOnly(dto.startDate), endDate: dto.endDate ? toDateOnly(dto.endDate) : null,
          },
          select: ASSIGNMENT_SELECT,
        });
      });
      const dtoResult = toAssignmentDto(assignment);
      await this.idempotency.save(organizationId, idempotencyKey, CREATE_ENDPOINT, userId, requestHash, 201, dtoResult);
      return dtoResult;
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw AppError.conflict('Bed is already assigned within this period', ErrorCode.BED_ASSIGNMENT_OVERLAP);
      }
      throw err;
    }
  }

  async end(organizationId: string, assignmentId: string) {
    const assignment = await this.prisma.bedAssignment.findFirst({ where: { id: assignmentId, organizationId }, select: ASSIGNMENT_SELECT });
    if (!assignment) throw AppError.notFound('Assignment not found');
    if (assignment.status === AssignmentStatus.ENDED) return toAssignmentDto(assignment);

    const updated = await this.prisma.bedAssignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.ENDED, endDate: new Date(), version: { increment: 1 } },
      select: ASSIGNMENT_SELECT,
    });
    return toAssignmentDto(updated);
  }
}