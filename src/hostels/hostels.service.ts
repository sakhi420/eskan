import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { ArchiveStatus } from '../generated/prisma/enums';
import { HostelDto } from './dto/hostel.dto';

const HOSTEL_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  name: true,
  address: true,
  notes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface HostelRow {
  id: string;
  version: number;
  organizationId: string;
  name: string;
  address: string | null;
  notes: string | null;
  status: ArchiveStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toHostelDto(row: HostelRow) {
  return {
    id: row.id,
    version: row.version,
    organizationId: row.organizationId,
    name: row.name,
    address: row.address,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const CREATE_ENDPOINT = '/api/v1/hostels';

@Injectable()
export class HostelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(organizationId: string, page: number, size: number, q?: string) {
    const where = {
      organizationId,
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    };
    const skip = (page - 1) * size;
    const [rows, totalElements] = await this.prisma.$transaction([
      this.prisma.hostel.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: size,
        select: HOSTEL_SELECT,
      }),
      this.prisma.hostel.count({ where }),
    ]);
    return {
      items: rows.map(toHostelDto),
      page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
    };
  }

  async create(
    organizationId: string,
    userId: string,
    dto: HostelDto,
    idempotencyKey: string,
  ) {
    const requestHash = this.idempotency.hash(dto);
    const replay = await this.idempotency.getReplay<ReturnType<typeof toHostelDto>>(
      organizationId,
      idempotencyKey,
      CREATE_ENDPOINT,
      requestHash,
    );
    if (replay) return replay;

    const hostel = await this.prisma.hostel.create({
      data: {
        organizationId,
        name: dto.name,
        address: dto.address,
        notes: dto.notes,
      },
      select: HOSTEL_SELECT,
    });

    const dtoResult = toHostelDto(hostel);
    await this.idempotency.save(
      organizationId,
      idempotencyKey,
      CREATE_ENDPOINT,
      userId,
      requestHash,
      201,
      dtoResult,
    );
    return dtoResult;
  }

  async get(organizationId: string, hostelId: string) {
    const hostel = await this.prisma.hostel.findFirst({
      where: { id: hostelId, organizationId },
      select: HOSTEL_SELECT,
    });
    if (!hostel) throw AppError.notFound('Hostel not found');
    return toHostelDto(hostel);
  }

  async update(
    organizationId: string,
    hostelId: string,
    expectedVersion: number,
    dto: HostelDto,
  ) {
    const hostel = await this.prisma.hostel.findFirst({
      where: { id: hostelId, organizationId },
      select: HOSTEL_SELECT,
    });
    if (!hostel) throw AppError.notFound('Hostel not found');
    if (hostel.version !== expectedVersion) {
      throw AppError.conflict(
        'Hostel was modified by another request; refresh and retry',
        ErrorCode.RESOURCE_VERSION_CONFLICT,
      );
    }

    const updated = await this.prisma.hostel.update({
      where: { id: hostelId },
      data: {
        name: dto.name,
        address: dto.address,
        notes: dto.notes,
        version: { increment: 1 },
      },
      select: HOSTEL_SELECT,
    });
    return toHostelDto(updated);
  }

  async archive(organizationId: string, hostelId: string) {
    const hostel = await this.prisma.hostel.findFirst({
      where: { id: hostelId, organizationId },
      select: HOSTEL_SELECT,
    });
    if (!hostel) throw AppError.notFound('Hostel not found');

    if (hostel.status === ArchiveStatus.ARCHIVED) return toHostelDto(hostel);

    const activeRooms = await this.prisma.room.count({
      where: { hostelId, status: ArchiveStatus.ACTIVE },
    });
    if (activeRooms > 0) {
      throw AppError.conflict(
        'Hostel still has active rooms; archive them first',
        ErrorCode.RESOURCE_HAS_ACTIVE_ASSIGNMENT,
      );
    }

    const updated = await this.prisma.hostel.update({
      where: { id: hostelId },
      data: { status: ArchiveStatus.ARCHIVED, version: { increment: 1 } },
      select: HOSTEL_SELECT,
    });
    return toHostelDto(updated);
  }
}