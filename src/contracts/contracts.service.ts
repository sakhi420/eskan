import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { isUniqueViolation } from '../common/prisma/unique-violation';
import { ArchiveStatus, BillingCycle, ContractStatus, PackageComponentKind } from '../generated/prisma/enums';
import { ContractDto } from './dto/contract.dto';

const CONTRACT_SELECT = {
  id: true, version: true, organizationId: true, hostelId: true, residentId: true, contractNumber: true,
  status: true, startDate: true, endDate: true, rentAmount: true, billingCycle: true, depositAmount: true,
  packageId: true, packageSnapshot: true, notes: true, createdAt: true, updatedAt: true,
} as const;

interface ComponentSnapshot {
  kind: PackageComponentKind; name: string; amount: number; deductibleOnAbsence: boolean;
}

interface ContractRow {
  id: string; version: number; organizationId: string; hostelId: string; residentId: string;
  contractNumber: string; status: ContractStatus; startDate: Date; endDate: Date | null;
  rentAmount: number; billingCycle: BillingCycle; depositAmount: number | null;
  packageId: string | null; packageSnapshot: Prisma.JsonValue | null; notes: string | null;
  createdAt: Date; updatedAt: Date;
}

function toISODate(value: Date | string | null): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function toDateOnly(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

function snapshotToComponents(snapshot: Prisma.JsonValue | null): ComponentSnapshot[] {
  if (!snapshot || !Array.isArray(snapshot)) return [];
  return (snapshot as unknown as ComponentSnapshot[]).map((c) => ({
    kind: c.kind, name: c.name, amount: c.amount, deductibleOnAbsence: c.deductibleOnAbsence,
  }));
}

function toStayContractDto(row: ContractRow) {
  return {
    id: row.id, version: row.version, organizationId: row.organizationId,
    hostelId: row.hostelId, residentId: row.residentId, contractNumber: row.contractNumber,
    status: row.status, startDate: toISODate(row.startDate), endDate: toISODate(row.endDate),
    rent: { amount: row.rentAmount, currency: 'AFN' },
    billingCycle: row.billingCycle,
    deposit: row.depositAmount != null ? { amount: row.depositAmount, currency: 'AFN' } : null,
    packageId: row.packageId, packageComponents: snapshotToComponents(row.packageSnapshot),
    notes: row.notes, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function generateContractNumber(): string {
  return `CNT-${randomBytes(4).toString('hex').toUpperCase()}`;
}

const CREATE_ENDPOINT = '/api/v1/contracts';

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService, private readonly idempotency: IdempotencyService) {}

  async list(organizationId: string, page: number, size: number, status?: ContractStatus) {
    const where: Prisma.StayContractWhereInput = { organizationId, ...(status ? { status } : {}) };
    const skip = (page - 1) * size;
    const [rows, totalElements] = await this.prisma.$transaction([
      this.prisma.stayContract.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size, select: CONTRACT_SELECT }),
      this.prisma.stayContract.count({ where }),
    ]);
    return { items: rows.map(toStayContractDto), page, size, totalElements, totalPages: Math.ceil(totalElements / size) };
  }

  async listByResident(organizationId: string, residentId: string) {
    const rows = await this.prisma.stayContract.findMany({
      where: { organizationId, residentId }, orderBy: { createdAt: 'desc' }, select: CONTRACT_SELECT,
    });
    return rows.map(toStayContractDto);
  }

  async get(organizationId: string, contractId: string) {
    const contract = await this.prisma.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
    if (!contract) throw AppError.notFound('Contract not found');
    return toStayContractDto(contract);
  }
private async resolve(organizationId: string, dto: ContractDto): Promise<{ rentAmount: number; snapshot: ComponentSnapshot[] }> {
    const hostel = await this.prisma.hostel.findFirst({ where: { id: dto.hostelId, organizationId }, select: { id: true } });
    if (!hostel) throw AppError.notFound('Hostel not found');
    const resident = await this.prisma.resident.findFirst({ where: { id: dto.residentId, organizationId }, select: { id: true } });
    if (!resident) throw AppError.notFound('Resident not found');

    let snapshot: ComponentSnapshot[] = [];
    if (dto.packageId) {
      const pkg = await this.prisma.accommodationPackage.findFirst({
        where: { id: dto.packageId, organizationId, status: ArchiveStatus.ACTIVE },
        include: { components: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!pkg) throw AppError.notFound('Package not found or not active');
      if (pkg.hostelId && pkg.hostelId !== dto.hostelId) {
        throw AppError.conflict('Package belongs to a different hostel', ErrorCode.BUSINESS_RULE_VIOLATION);
      }
      snapshot = pkg.components.map((c) => ({ kind: c.kind, name: c.name, amount: c.amount, deductibleOnAbsence: c.deductibleOnAbsence }));
      const sum = snapshot.reduce((acc, c) => acc + c.amount, 0);
      if (dto.rent.amount !== sum) {
        throw AppError.validation('Contract rent must equal the sum of the selected package components', [
          { field: 'rent.amount', code: 'mismatch', message: `expected ${sum}` },
        ]);
      }
    }
    return { rentAmount: dto.rent.amount, snapshot };
  }

  async create(organizationId: string, userId: string, dto: ContractDto, idempotencyKey: string) {
    const { rentAmount, snapshot } = await this.resolve(organizationId, dto);

    const requestHash = this.idempotency.hash(dto);
    const replay = await this.idempotency.getReplay<ReturnType<typeof toStayContractDto>>(organizationId, idempotencyKey, CREATE_ENDPOINT, requestHash);
    if (replay) return replay;

    try {
      const contract = await this.prisma.stayContract.create({
        data: {
          organizationId, hostelId: dto.hostelId, residentId: dto.residentId,
          contractNumber: generateContractNumber(), startDate: toDateOnly(dto.startDate),
          endDate: dto.endDate ? toDateOnly(dto.endDate) : null, rentAmount,
          billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY,
          depositAmount: dto.deposit?.amount ?? null, packageId: dto.packageId ?? null,
          packageSnapshot: snapshot.length ? (snapshot as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          notes: dto.notes,
        },
        select: CONTRACT_SELECT,
      });
      const dtoResult = toStayContractDto(contract);
      await this.idempotency.save(organizationId, idempotencyKey, CREATE_ENDPOINT, userId, requestHash, 201, dtoResult);
      return dtoResult;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict('Failed to allocate a unique contract number; retry', ErrorCode.BUSINESS_RULE_VIOLATION);
      }
      throw err;
    }
  }
async update(organizationId: string, contractId: string, expectedVersion: number, dto: ContractDto) {
    const contract = await this.prisma.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
    if (!contract) throw AppError.notFound('Contract not found');
    if (contract.status !== ContractStatus.DRAFT) {
      throw AppError.conflict('Only DRAFT contracts can be edited', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (contract.version !== expectedVersion) {
      throw AppError.conflict('Contract was modified by another request; refresh and retry', ErrorCode.RESOURCE_VERSION_CONFLICT);
    }
    const { rentAmount, snapshot } = await this.resolve(organizationId, dto);

    const updated = await this.prisma.stayContract.update({
      where: { id: contractId },
      data: {
        hostelId: dto.hostelId, residentId: dto.residentId, startDate: toDateOnly(dto.startDate),
        endDate: dto.endDate ? toDateOnly(dto.endDate) : null, rentAmount,
        billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY, depositAmount: dto.deposit?.amount ?? null,
        packageId: dto.packageId ?? null,
        packageSnapshot: snapshot.length ? (snapshot as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        notes: dto.notes, version: { increment: 1 },
      },
      select: CONTRACT_SELECT,
    });
    return toStayContractDto(updated);
  }

  async activate(organizationId: string, contractId: string) {
    const contract = await this.prisma.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
    if (!contract) throw AppError.notFound('Contract not found');
    if (contract.status === ContractStatus.ACTIVE) return toStayContractDto(contract);
    if (contract.status !== ContractStatus.DRAFT) {
      throw AppError.conflict('Only DRAFT contracts can be activated', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    const updated = await this.prisma.stayContract.update({
      where: { id: contractId },
      data: { status: ContractStatus.ACTIVE, version: { increment: 1 } },
      select: CONTRACT_SELECT,
    });
    return toStayContractDto(updated);
  }

  async terminate(organizationId: string, contractId: string) {
    const contract = await this.prisma.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
    if (!contract) throw AppError.notFound('Contract not found');
    if (contract.status === ContractStatus.TERMINATED) return toStayContractDto(contract);
    if (contract.status === ContractStatus.CLOSED) {
      throw AppError.conflict('Closed contract cannot be terminated', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    if (contract.status === ContractStatus.ACTIVE) {
      const activeAssignments = await this.prisma.bedAssignment.count({
        where: { contractId, organizationId, status: 'ACTIVE' as const },
      });
      if (activeAssignments > 0) {
        throw AppError.conflict('Contract still has an active bed assignment; end it first', ErrorCode.RESOURCE_HAS_ACTIVE_ASSIGNMENT);
      }
    }
    const updated = await this.prisma.stayContract.update({
      where: { id: contractId },
      data: { status: ContractStatus.TERMINATED, version: { increment: 1 } },
      select: CONTRACT_SELECT,
    });
    return toStayContractDto(updated);
  }
}