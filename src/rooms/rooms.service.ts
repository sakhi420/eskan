import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { isUniqueViolation } from '../common/prisma/unique-violation';
import { ArchiveStatus, BedStatus } from '../generated/prisma/enums';
import { RoomDto } from './dto/room.dto';

const ROOM_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  hostelId: true,
  code: true,
  floor: true,
  notes: true,
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
  ) {}

  private async assertHostel(organizationId: string, hostelId: string): Promise<void> {
    const hostel = await this.prisma.hostel.findFirst({
      where: { id: hostelId, organizationId },
      select: { id: true },
    });
    if (!hostel) throw AppError.notFound('Hostel not found');
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
    await this.assertHostel(organizationId, hostelId);

    const endpoint = `/api/v1/hostels/${hostelId}/rooms`;
    const requestHash = this.idempotency.hash(dto);
    const replay = await this.idempotency.getReplay<ReturnType<typeof toRoomDto>>(
      organizationId,
      idempotencyKey,
      endpoint,
      requestHash,
    );
    if (replay) return replay;

    try {
      const room = await this.prisma.room.create({
        data: {
          organizationId,
          hostelId,
          code: dto.code,
          floor: dto.floor,
          notes: dto.notes,
        },
        select: ROOM_SELECT,
      });
      const dtoResult = toRoomDto(room);
      await this.idempotency.save(organizationId, idempotencyKey, endpoint, userId, requestHash, 201, dtoResult);
      return dtoResult;
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

  async get(organizationId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, organizationId },
      select: ROOM_SELECT,
    });
    if (!room) throw AppError.notFound('Room not found');
    return toRoomDto(room);
  }

  async update(organizationId: string, roomId: string, expectedVersion: number, dto: RoomDto) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, organizationId },
      select: ROOM_SELECT,
    });
    if (!room) throw AppError.notFound('Room not found');
    if (room.version !== expectedVersion) {
      throw AppError.conflict(
        'Room was modified by another request; refresh and retry',
        ErrorCode.RESOURCE_VERSION_CONFLICT,
      );
    }

    try {
      const updated = await this.prisma.room.update({
        where: { id: roomId },
        data: {
          code: dto.code,
          floor: dto.floor,
          notes: dto.notes,
          version: { increment: 1 },
        },
        select: ROOM_SELECT,
      });
      return toRoomDto(updated);
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
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, organizationId },
      select: ROOM_SELECT,
    });
    if (!room) throw AppError.notFound('Room not found');
    if (room.status === ArchiveStatus.ARCHIVED) return toRoomDto(room);

    const activeBeds = await this.prisma.bed.count({
      where: { roomId, status: BedStatus.ACTIVE },
    });
    if (activeBeds > 0) {
      throw AppError.conflict(
        'Room still has active beds; deactivate them first',
        ErrorCode.RESOURCE_HAS_ACTIVE_ASSIGNMENT,
      );
    }

    const updated = await this.prisma.room.update({
      where: { id: roomId },
      data: { status: ArchiveStatus.ARCHIVED, version: { increment: 1 } },
      select: ROOM_SELECT,
    });
    return toRoomDto(updated);
  }
}