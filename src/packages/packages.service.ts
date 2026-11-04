import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { ArchiveStatus, PackageComponentKind } from '../generated/prisma/enums';
import { PackageComponentDto, PackageDto } from './dto/package.dto';

const COMPONENT_SELECT = {
  id: true,
  kind: true,
  name: true,
  amount: true,
  deductibleOnAbsence: true,
} as const;

const PACKAGE_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  hostelId: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  components: { orderBy: { sortOrder: 'asc' as const }, select: COMPONENT_SELECT },
} as const;

interface ComponentRow {
  id: string;
  kind: PackageComponentKind;
  name: string;
  amount: number;
  deductibleOnAbsence: boolean;
}

interface PackageRow {
  id: string;
  version: number;
  organizationId: string;
  hostelId: string | null;
  name: string;
  description: string | null;
  status: ArchiveStatus;
  createdAt: Date;
  updatedAt: Date;
  components: ComponentRow[];
}

function toPackageDto(row: PackageRow) {
  return {
    id: row.id,
    version: row.version,
    organizationId: row.organizationId,
    hostelId: row.hostelId,
    name: row.name,
    description: row.description,
    status: row.status,
    components: row.components.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      amount: c.amount,
      deductibleOnAbsence: c.deductibleOnAbsence,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function componentsToCreate(components: PackageComponentDto[]) {
  return components.map((c, index) => ({
    kind: c.kind,
    name: c.name,
    amount: c.amount,
    deductibleOnAbsence: c.deductibleOnAbsence,
    sortOrder: index,
  }));
}

function validateComposition(components: PackageComponentDto[]): void {
  const hasAccommodation = components.some((c) => c.kind === PackageComponentKind.ACCOMMODATION);
  if (!hasAccommodation) {
    throw AppError.validation('A package must include an ACCOMMODATION component', [
      { field: 'components', code: 'invalid', message: 'missing ACCOMMODATION component' },
    ]);
  }
}

@Injectable()
export class PackagesService {
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
      this.prisma.accommodationPackage.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: size,
        select: PACKAGE_SELECT,
      }),
      this.prisma.accommodationPackage.count({ where }),
    ]);
    return {
      items: rows.map(toPackageDto),
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
    dto: PackageDto,
    idempotencyKey: string,
  ) {
    await this.assertHostel(organizationId, hostelId);
    validateComposition(dto.components);

    const endpoint = `/api/v1/hostels/${hostelId}/packages`;
    const requestHash = this.idempotency.hash(dto);
    const replay = await this.idempotency.getReplay<ReturnType<typeof toPackageDto>>(
      organizationId,
      idempotencyKey,
      endpoint,
      requestHash,
    );
    if (replay) return replay;

    const pkg = await this.prisma.accommodationPackage.create({
      data: {
        organizationId,
        hostelId,
        name: dto.name,
        description: dto.description,
        components: { create: componentsToCreate(dto.components) },
      },
      select: PACKAGE_SELECT,
    });

    const dtoResult = toPackageDto(pkg);
    await this.idempotency.save(
      organizationId,
      idempotencyKey,
      endpoint,
      userId,
      requestHash,
      201,
      dtoResult,
    );
    return dtoResult;
  }

  async get(organizationId: string, packageId: string) {
    const pkg = await this.prisma.accommodationPackage.findFirst({
      where: { id: packageId, organizationId },
      select: PACKAGE_SELECT,
    });
    if (!pkg) throw AppError.notFound('Package not found');
    return toPackageDto(pkg);
  }

  async update(
    organizationId: string,
    packageId: string,
    expectedVersion: number,
    dto: PackageDto,
  ) {
    validateComposition(dto.components);
    const pkg = await this.prisma.accommodationPackage.findFirst({
      where: { id: packageId, organizationId },
      select: PACKAGE_SELECT,
    });
    if (!pkg) throw AppError.notFound('Package not found');
    if (pkg.version !== expectedVersion) {
      throw AppError.conflict(
        'Package was modified by another request; refresh and retry',
        ErrorCode.RESOURCE_VERSION_CONFLICT,
      );
    }

    const updated = await this.prisma.accommodationPackage.update({
      where: { id: packageId },
      data: {
        name: dto.name,
        description: dto.description,
        components: {
          deleteMany: {},
          create: componentsToCreate(dto.components),
        },
        version: { increment: 1 },
      },
      select: PACKAGE_SELECT,
    });
    return toPackageDto(updated);
  }

  async archive(organizationId: string, packageId: string) {
    const pkg = await this.prisma.accommodationPackage.findFirst({
      where: { id: packageId, organizationId },
      select: PACKAGE_SELECT,
    });
    if (!pkg) throw AppError.notFound('Package not found');
    if (pkg.status === ArchiveStatus.ARCHIVED) return toPackageDto(pkg);

    const updated = await this.prisma.accommodationPackage.update({
      where: { id: packageId },
      data: { status: ArchiveStatus.ARCHIVED, version: { increment: 1 } },
      select: PACKAGE_SELECT,
    });
    return toPackageDto(updated);
  }
}