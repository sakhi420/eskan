import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { LockService } from '../common/concurrency/lock.service';
import { isUniqueViolation } from '../common/prisma/unique-violation';
import { ArchiveStatus, AssignmentStatus, BedStatus, MaintenanceStatus } from '../generated/prisma/enums';
import { RoomDto } from './dto/room.dto';

const ROOM_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  hostelId: true,
  code: true,
  floor: true,
  notes: true,
  maintenanceStatus: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface RoomRow {
  id: string;
  version: number;
  organizationId: string;
  hostelId: string;
  code: string;
  floor: number;
  notes: string | null;
  maintenanceStatus: MaintenanceStatus;
  status: ArchiveStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toRoomDto(row: RoomRow) {
  return {
    id: row.id,
    version: row.version,
    organizationId: row.organizationId,
    hostelId: row.hostelId,
    code: row.code,
    floor: row.floor,
    notes: row.notes,
    maintenanceStatus: row.maintenanceStatus,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly locks: LockService,
  ) {}

  private async assertHostel(organizationId: string, hostelId: string): Promise<void> {
    const hostel = await this.prisma.hostel.findFirst({
      where: { id: hostelId, organizationId },
      select: { id: true, status: true },
    });
    if (!hostel) throw AppError.notFound('Hostel not found');
    if (hostel.status === ArchiveStatus.ARCHIVED) {
      throw AppError.conflict(
        'Hostel is archived; no new rooms can be added',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
  }

  /** Authoritative, lock-guarded hostel check used inside the create transaction. */
  private async assertHostelForCreate(
    tx: Prisma.TransactionClient,
    organizationId: string,
    hostelId: string,
  ): Promise<void> {
    await this.locks.lockHostel(tx, hostelId, organizationId);
    const hostel = await tx.hostel.findFirst({
      where: { id: hostelId, organizationId },
      select: { id: true, status: true },
    });
    if (!hostel) throw AppError.notFound('Hostel not found');
    if (hostel.status === ArchiveStatus.ARCHIVED) {
      throw AppError.conflict(
        'Hostel is archived; no new rooms can be added',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
  }

  async list(organizationId: string, hostelId: string, page: number, size: number) {
    await this.assertHostel(organizationId, hostelId);
    const where = { organizationId, hostelId };
    const skip = (page - 1) * size;
    const [rows, totalElements] = await this.prisma.$transaction([
      this.prisma.room.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: size,
        select: ROOM_SELECT,
      }),
      this.prisma.room.count({ where }),
    ]);
    return {
      items: rows.map(toRoomDto),
      page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
    };
  }

  async create(
    organizationId: string,
    userId: string,
    hostelId: string,
    dto: RoomDto,
    idempotencyKey: string,
  ) {
    // Replay must be checked before any domain reads (runAtomic does so), so the
    // parent-hostel assertion happens only inside the transaction below.
    const endpoint = `/api/v1/hostels/${hostelId}/rooms`;
    const requestHash = this.idempotency.hash(dto);
    return this.idempotency.runAtomic<ReturnType<typeof toRoomDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201 },
      async (tx) => {
        await this.assertHostelForCreate(tx, organizationId, hostelId);
        try {
          const room = await tx.room.create({
            data: {
              organizationId,
              hostelId,
              code: dto.code,
              floor: dto.floor,
              maintenanceStatus: dto.maintenanceStatus,
              notes: dto.notes,
            },
            select: ROOM_SELECT,
          });
          return toRoomDto(room);
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw AppError.conflict(
              'A room with this code already exists in this hostel',
              ErrorCode.DUPLICATE_CODE,
            );
          }
          throw err;
        }
      },
    );
  }

  async get(organizationId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, organizationId },
      select: ROOM_SELECT,
    });
    if (!room) throw AppError.notFound('Room not found');
    return toRoomDto(room);
  }

  async update(organizationId: string, roomId: string, expectedVersion: number, dto: RoomDto) {
    const blockMaintenance =
      dto.maintenanceStatus === MaintenanceStatus.OUT_OF_SERVICE ||
      dto.maintenanceStatus === MaintenanceStatus.NEEDS_REPAIR;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the room so a concurrent assignment create (which locks the room in
        // the canonical order) serializes before the maintenance-status guard below.
        await this.locks.lockRoom(tx, roomId, organizationId);

        const room = await tx.room.findFirst({
          where: { id: roomId, organizationId },
          select: { id: true },
        });
        if (!room) throw AppError.notFound('Room not found');

        if (blockMaintenance) {
          const activeAssignments = await tx.bedAssignment.count({
            where: { bed: { roomId }, status: AssignmentStatus.ACTIVE },
          });
          if (activeAssignments > 0) {
            throw AppError.conflict(
              'Room still has an active assignment; it cannot be taken out of service',
              ErrorCode.RESOURCE_HAS_ACTIVE_ASSIGNMENT,
            );
          }
        }

        // Compare-and-swap update: only applies when version still matches.
        const result = await tx.room.updateMany({
          where: { id: roomId, organizationId, version: expectedVersion },
          data: {
            code: dto.code,
            floor: dto.floor,
            maintenanceStatus: dto.maintenanceStatus,
            notes: dto.notes,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw AppError.conflict(
            'Room was modified by another request; refresh and retry',
            ErrorCode.RESOURCE_VERSION_CONFLICT,
          );
        }

        const updated = await tx.room.findFirst({
          where: { id: roomId, organizationId },
          select: ROOM_SELECT,
        });
        return toRoomDto(updated!);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict(
          'A room with this code already exists in this hostel',
          ErrorCode.DUPLICATE_CODE,
        );
      }
      throw err;
    }
  }

  async archive(organizationId: string, roomId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the room row so a concurrent bed create (which locks the room in
      // the canonical order) serializes before the archive check-and-set below.
      await this.locks.lockRoom(tx, roomId, organizationId);

      const room = await tx.room.findFirst({
        where: { id: roomId, organizationId },
        select: ROOM_SELECT,
      });
      if (!room) throw AppError.notFound('Room not found');
      if (room.status === ArchiveStatus.ARCHIVED) return toRoomDto(room);

      const activeBeds = await tx.bed.count({
        where: { roomId, status: BedStatus.ACTIVE },
      });
      if (activeBeds > 0) {
        throw AppError.conflict(
          'Room still has active beds; deactivate them first',
          ErrorCode.RESOURCE_HAS_ACTIVE_ASSIGNMENT,
        );
      }

      const updated = await tx.room.update({
        where: { id: roomId },
        data: { status: ArchiveStatus.ARCHIVED, version: { increment: 1 } },
        select: ROOM_SELECT,
      });
      return toRoomDto(updated);
    });
  }
}