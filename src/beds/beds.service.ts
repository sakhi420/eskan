import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { isUniqueViolation } from '../common/prisma/unique-violation';
import { ArchiveStatus, AssignmentStatus, BedStatus, MaintenanceStatus } from '../generated/prisma/enums';
import { BedDto } from './dto/bed.dto';

const BED_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  roomId: true,
  code: true,
  notes: true,
  maintenanceStatus: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface BedRow {
  id: string;
  version: number;
  organizationId: string;
  roomId: string;
  code: string;
  notes: string | null;
  maintenanceStatus: MaintenanceStatus;
  status: BedStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toBedDto(row: BedRow) {
  return {
    id: row.id,
    version: row.version,
    organizationId: row.organizationId,
    roomId: row.roomId,
    code: row.code,
    notes: row.notes,
    maintenanceStatus: row.maintenanceStatus,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class BedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private async assertRoom(organizationId: string, roomId: string): Promise<void> {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, organizationId },
      select: { id: true, status: true },
    });
    if (!room) throw AppError.notFound('Room not found');
    if (room.status === ArchiveStatus.ARCHIVED) {
      throw AppError.conflict(
        'Room is archived; no new beds can be added',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
  }

  async listByRoom(organizationId: string, roomId: string, page: number, size: number) {
    await this.assertRoom(organizationId, roomId);
    const where = { organizationId, roomId };
    const skip = (page - 1) * size;
    const [rows, totalElements] = await this.prisma.$transaction([
      this.prisma.bed.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: size,
        select: BED_SELECT,
      }),
      this.prisma.bed.count({ where }),
    ]);
    return {
      items: rows.map(toBedDto),
      page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
    };
  }

  async create(
    organizationId: string,
    userId: string,
    roomId: string,
    dto: BedDto,
    idempotencyKey: string,
  ) {
    await this.assertRoom(organizationId, roomId);

    const endpoint = `/api/v1/rooms/${roomId}/beds`;
    const requestHash = this.idempotency.hash(dto);
    return this.idempotency.runAtomic<ReturnType<typeof toBedDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201 },
      async (tx) => {
        try {
          const bed = await tx.bed.create({
            data: { organizationId, roomId, code: dto.code, notes: dto.notes, maintenanceStatus: dto.maintenanceStatus ?? MaintenanceStatus.OPERATIONAL },
            select: BED_SELECT,
          });
          return toBedDto(bed);
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw AppError.conflict(
              'A bed with this code already exists in this room',
              ErrorCode.DUPLICATE_CODE,
            );
          }
          throw err;
        }
      },
    );
  }

  async get(organizationId: string, bedId: string) {
    const bed = await this.prisma.bed.findFirst({
      where: { id: bedId, organizationId },
      select: BED_SELECT,
    });
    if (!bed) throw AppError.notFound('Bed not found');
    return toBedDto(bed);
  }

  async update(organizationId: string, bedId: string, expectedVersion: number, dto: BedDto) {
    try {
      // Compare-and-swap update: only applies when version still matches.
      const result = await this.prisma.bed.updateMany({
        where: { id: bedId, organizationId, version: expectedVersion },
        data: {
          code: dto.code,
          maintenanceStatus: dto.maintenanceStatus,
          notes: dto.notes,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        const exists = await this.prisma.bed.findFirst({
          where: { id: bedId, organizationId },
          select: { id: true },
        });
        if (!exists) throw AppError.notFound('Bed not found');
        throw AppError.conflict(
          'Bed was modified by another request; refresh and retry',
          ErrorCode.RESOURCE_VERSION_CONFLICT,
        );
      }
      const updated = await this.prisma.bed.findFirst({
        where: { id: bedId, organizationId },
        select: BED_SELECT,
      });
      return toBedDto(updated!);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict(
          'A bed with this code already exists in this room',
          ErrorCode.DUPLICATE_CODE,
        );
      }
      throw err;
    }
  }

  async deactivate(organizationId: string, bedId: string) {
    const bed = await this.prisma.bed.findFirst({
      where: { id: bedId, organizationId },
      select: BED_SELECT,
    });
    if (!bed) throw AppError.notFound('Bed not found');
    if (bed.status === BedStatus.INACTIVE) return toBedDto(bed);

    const activeAssignments = await this.prisma.bedAssignment.count({
      where: { bedId, status: AssignmentStatus.ACTIVE },
    });
    if (activeAssignments > 0) {
      throw AppError.conflict(
        'Bed still has an active assignment; end it first',
        ErrorCode.RESOURCE_HAS_ACTIVE_ASSIGNMENT,
      );
    }

    const updated = await this.prisma.bed.update({
      where: { id: bedId },
      data: { status: BedStatus.INACTIVE, version: { increment: 1 } },
      select: BED_SELECT,
    });
    return toBedDto(updated);
  }
}