import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { LockService } from '../common/concurrency/lock.service';
import { AssignmentStatus, ContractStatus, ResidentStatus, ResidentType } from '../generated/prisma/enums';
import { ResidentDto } from './dto/resident.dto';

const RESIDENT_SELECT = {
  id: true, version: true, organizationId: true, fullName: true, type: true, phone: true,
  emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelation: true,
  notes: true, status: true, createdAt: true, updatedAt: true,
} as const;

interface ResidentRow {
  id: string; version: number; organizationId: string; fullName: string; type: ResidentType;
  phone: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null;
  emergencyContactRelation: string | null; notes: string | null; status: ResidentStatus;
  createdAt: Date; updatedAt: Date;
}

function toResidentDto(row: ResidentRow) {
  return {
    id: row.id, version: row.version, organizationId: row.organizationId,
    fullName: row.fullName, type: row.type, phone: row.phone,
    emergencyContactName: row.emergencyContactName, emergencyContactPhone: row.emergencyContactPhone,
    emergencyContactRelation: row.emergencyContactRelation, notes: row.notes, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

const CREATE_ENDPOINT = '/api/v1/residents';

@Injectable()
export class ResidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly locks: LockService,
  ) {}

  async list(organizationId: string, page: number, size: number, q?: string, type?: ResidentType, status?: ResidentStatus) {
    const where: Prisma.ResidentWhereInput = {
      organizationId,
      ...(q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    };
    const skip = (page - 1) * size;
    const [rows, totalElements] = await this.prisma.$transaction([
      this.prisma.resident.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size, select: RESIDENT_SELECT }),
      this.prisma.resident.count({ where }),
    ]);
    return { items: rows.map(toResidentDto), page, size, totalElements, totalPages: Math.ceil(totalElements / size) };
  }

  async create(organizationId: string, userId: string, dto: ResidentDto, idempotencyKey: string) {
    const requestHash = this.idempotency.hash(dto);
    return this.idempotency.runAtomic<ReturnType<typeof toResidentDto>>(
      { organizationId, key: idempotencyKey, endpoint: CREATE_ENDPOINT, userId, requestHash, statusCode: 201 },
      async (tx) => {
        const resident = await tx.resident.create({
          data: {
            organizationId, fullName: dto.fullName, type: dto.type, phone: dto.phone,
            emergencyContactName: dto.emergencyContactName, emergencyContactPhone: dto.emergencyContactPhone,
            emergencyContactRelation: dto.emergencyContactRelation, notes: dto.notes,
          },
          select: RESIDENT_SELECT,
        });
        return toResidentDto(resident);
      },
    );
  }

  async get(organizationId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({ where: { id: residentId, organizationId }, select: RESIDENT_SELECT });
    if (!resident) throw AppError.notFound('Resident not found');
    return toResidentDto(resident);
  }

  async update(organizationId: string, residentId: string, expectedVersion: number, dto: ResidentDto) {
    // Compare-and-swap update: only applies when version still matches.
    const result = await this.prisma.resident.updateMany({
      where: { id: residentId, organizationId, version: expectedVersion },
      data: {
        fullName: dto.fullName, type: dto.type, phone: dto.phone,
        emergencyContactName: dto.emergencyContactName, emergencyContactPhone: dto.emergencyContactPhone,
        emergencyContactRelation: dto.emergencyContactRelation, notes: dto.notes, version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      const exists = await this.prisma.resident.findFirst({ where: { id: residentId, organizationId }, select: { id: true } });
      if (!exists) throw AppError.notFound('Resident not found');
      throw AppError.conflict('Resident was modified by another request; refresh and retry', ErrorCode.RESOURCE_VERSION_CONFLICT);
    }
    const updated = await this.prisma.resident.findFirst({ where: { id: residentId, organizationId }, select: RESIDENT_SELECT });
    return toResidentDto(updated!);
  }

  async archive(organizationId: string, residentId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the resident first so a concurrent contract/assignment create
      // (which also locks the resident) cannot interleave with the
      // "active contract/assignment" guard below.
      await this.locks.lockResident(tx, residentId);
      const resident = await tx.resident.findFirst({ where: { id: residentId, organizationId }, select: RESIDENT_SELECT });
      if (!resident) throw AppError.notFound('Resident not found');
      if (resident.status === ResidentStatus.ARCHIVED) return toResidentDto(resident);

      const activeContracts = await tx.stayContract.count({ where: { residentId, organizationId, status: ContractStatus.ACTIVE } });
      const activeAssignments = await tx.bedAssignment.count({ where: { residentId, organizationId, status: AssignmentStatus.ACTIVE } });
      if (activeContracts > 0 || activeAssignments > 0) {
        throw AppError.conflict('Resident still has an active contract or bed assignment; resolve them first', ErrorCode.RESOURCE_HAS_ACTIVE_ASSIGNMENT);
      }

      const updated = await tx.resident.update({
        where: { id: residentId },
        data: { status: ResidentStatus.ARCHIVED, version: { increment: 1 } },
        select: RESIDENT_SELECT,
      });
      return toResidentDto(updated);
    });
  }
}