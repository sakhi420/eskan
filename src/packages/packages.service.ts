import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { LockService } from '../common/concurrency/lock.service';
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
        'Hostel is archived; no new packages can be added',
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
        'Hostel is archived; no new packages can be added',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
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
    validateComposition(dto.components);

    // Replay must be checked before any domain reads (runAtomic does so), so the
    // parent-hostel assertion happens only inside the transaction below.
    const endpoint = `/api/v1/hostels/${hostelId}/packages`;
    const requestHash = this.idempotency.hash(dto);
    return this.idempotency.runAtomic<ReturnType<typeof toPackageDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201 },
      async (tx) => {
        await this.assertHostelForCreate(tx, organizationId, hostelId);
        const pkg = await tx.accommodationPackage.create({
          data: {
            organizationId,
            hostelId,
            name: dto.name,
            description: dto.description,
            components: { create: componentsToCreate(dto.components) },
          },
          select: PACKAGE_SELECT,
        });
        return toPackageDto(pkg);
      },
    );
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

    // Atomic + version-guarded: the conditional `updateMany` serializes on the
    // row lock, so two concurrent updates with the same version cannot both
    // succeed, and component replacement rolls back together with the header.
    return this.prisma.$transaction(async (tx) => {
      const guard = await tx.accommodationPackage.updateMany({
        where: { id: packageId, organizationId, version: expectedVersion },
        data: {
          name: dto.name,
          description: dto.description,
          version: { increment: 1 },
        },
      });
      if (guard.count === 0) {
        const exists = await tx.accommodationPackage.findFirst({
          where: { id: packageId, organizationId },
          select: { id: true },
        });
        if (!exists) throw AppError.notFound('Package not found');
        throw AppError.conflict(
          'Package was modified by another request; refresh and retry',
          ErrorCode.RESOURCE_VERSION_CONFLICT,
        );
      }

      await tx.accommodationPackageComponent.deleteMany({ where: { packageId } });
      const updated = await tx.accommodationPackage.update({
        where: { id: packageId },
        data: { components: { create: componentsToCreate(dto.components) } },
        select: PACKAGE_SELECT,
      });
      return toPackageDto(updated);
    });
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
