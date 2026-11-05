import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { LockService } from '../common/concurrency/lock.service';
import { businessTodayForOrg, toDateOnly as toBusinessDateOnly } from '../common/date/business-date';
import { isUniqueViolation } from '../common/prisma/unique-violation';
import { ArchiveStatus, AssignmentStatus, BillingCycle, ContractStatus, PackageComponentKind, ResidentStatus } from '../generated/prisma/enums';
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

function isExclusionViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; message?: string };
  const msg = `${e.code ?? ''} ${e.message ?? ''}`;
  return msg.includes('23P01') || /exclusion|no_overlap/i.test(msg);
}

const CREATE_ENDPOINT = '/api/v1/contracts';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly locks: LockService,
  ) {}

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
private async resolve(
    tx: Prisma.TransactionClient,
    organizationId: string,
    dto: ContractDto,
  ): Promise<{ rentAmount: number; snapshot: ComponentSnapshot[] }> {
    if (dto.endDate && dto.endDate <= dto.startDate) {
      throw AppError.validation('endDate must be after startDate', [
        { field: 'endDate', code: 'invalid', message: 'must be after startDate' },
      ]);
    }
    const hostel = await tx.hostel.findFirst({ where: { id: dto.hostelId, organizationId }, select: { id: true, status: true } });
    if (!hostel) throw AppError.notFound('Hostel not found');
    if (hostel.status === ArchiveStatus.ARCHIVED) {
      throw AppError.conflict('Hostel is archived; no new contracts can be created', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    const resident = await tx.resident.findFirst({ where: { id: dto.residentId, organizationId }, select: { id: true, status: true } });
    if (!resident) throw AppError.notFound('Resident not found');
    if (resident.status !== ResidentStatus.ACTIVE) {
      throw AppError.conflict('Resident is not active', ErrorCode.BUSINESS_RULE_VIOLATION);
    }

    let snapshot: ComponentSnapshot[] = [];
    if (dto.packageId) {
      const pkg = await tx.accommodationPackage.findFirst({
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

  /** Locks the contract's parents in canonical order before create/update. */
  private async lockContractParents(tx: Prisma.TransactionClient, hostelId: string, residentId: string): Promise<void> {
    await this.locks.lockHostel(tx, hostelId);
    await this.locks.lockResident(tx, residentId);
  }

  /** Rejects activation when the resident already has an overlapping ACTIVE contract. */
  private async assertNoActiveOverlap(
    tx: Prisma.TransactionClient,
    organizationId: string,
    residentId: string,
    startDate: Date,
    endDate: Date | null,
    excludeId: string,
  ): Promise<void> {
    const rows = await tx.stayContract.findMany({
      where: { residentId, organizationId, status: ContractStatus.ACTIVE, id: { not: excludeId } },
      select: { id: true, startDate: true, endDate: true },
    });
    const s = startDate.getTime();
    const e = endDate ? endDate.getTime() : null;
    const overlaps = rows.some((c) => {
      const cs = c.startDate.getTime();
      const ce = c.endDate ? c.endDate.getTime() : null;
      return (ce === null || s < ce) && (e === null || cs < e);
    });
    if (overlaps) {
      throw AppError.conflict(
        'Resident already has an active contract within this period',
        ErrorCode.RESIDENT_CONTRACT_OVERLAP,
      );
    }
  }

  async create(organizationId: string, userId: string, dto: ContractDto, idempotencyKey: string) {
    const requestHash = this.idempotency.hash(dto);
    // Replay before any domain reads: a retry must recover the stored result
    // even if the selected package was archived after the original commit.
    const replay = await this.idempotency.getReplay<ReturnType<typeof toStayContractDto>>(organizationId, idempotencyKey, CREATE_ENDPOINT, requestHash);
    if (replay) return replay;

    return this.idempotency.runAtomic<ReturnType<typeof toStayContractDto>>(
      { organizationId, key: idempotencyKey, endpoint: CREATE_ENDPOINT, userId, requestHash, statusCode: 201 },
      async (tx) => {
        await this.lockContractParents(tx, dto.hostelId, dto.residentId);
        const { rentAmount, snapshot } = await this.resolve(tx, organizationId, dto);
        try {
          const contract = await tx.stayContract.create({
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
          return toStayContractDto(contract);
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw AppError.conflict('Failed to allocate a unique contract number; retry', ErrorCode.BUSINESS_RULE_VIOLATION);
          }
          throw err;
        }
      },
    );
  }
async update(organizationId: string, contractId: string, expectedVersion: number, dto: ContractDto) {
    return this.prisma.$transaction(async (tx) => {
      // Status/version guard runs before the (expensive/validating) package
      // reconcile so a non-DRAFT contract is always rejected with the correct
      // conflict code instead of an unrelated validation error.
      const existing = await tx.stayContract.findFirst({
        where: { id: contractId, organizationId },
        select: { id: true, status: true, version: true },
      });
      if (!existing) throw AppError.notFound('Contract not found');
      if (existing.status !== ContractStatus.DRAFT) {
        throw AppError.conflict('Only DRAFT contracts can be edited', ErrorCode.BUSINESS_RULE_VIOLATION);
      }
      if (existing.version !== expectedVersion) {
        throw AppError.conflict('Contract was modified by another request; refresh and retry', ErrorCode.RESOURCE_VERSION_CONFLICT);
      }

      await this.lockContractParents(tx, dto.hostelId, dto.residentId);
      const { rentAmount, snapshot } = await this.resolve(tx, organizationId, dto);

      // Compare-and-swap update guarded by both status (DRAFT) and version.
      const result = await tx.stayContract.updateMany({
        where: { id: contractId, organizationId, status: ContractStatus.DRAFT, version: expectedVersion },
        data: {
          hostelId: dto.hostelId, residentId: dto.residentId, startDate: toDateOnly(dto.startDate),
          endDate: dto.endDate ? toDateOnly(dto.endDate) : null, rentAmount,
          billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY, depositAmount: dto.deposit?.amount ?? null,
          packageId: dto.packageId ?? null,
          packageSnapshot: snapshot.length ? (snapshot as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          notes: dto.notes, version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw AppError.conflict('Contract was modified by another request; refresh and retry', ErrorCode.RESOURCE_VERSION_CONFLICT);
      }

      const updated = await tx.stayContract.findFirst({
        where: { id: contractId, organizationId },
        select: CONTRACT_SELECT,
      });
      return toStayContractDto(updated!);
    });
  }

  async activate(organizationId: string, contractId: string) {
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.stayContract.findFirst({
        where: { id: contractId, organizationId },
        select: { id: true, status: true, hostelId: true, residentId: true, startDate: true, endDate: true },
      });
      if (!contract) throw AppError.notFound('Contract not found');
      if (contract.status === ContractStatus.ACTIVE) {
        const existing = await tx.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
        return toStayContractDto(existing!);
      }
      if (contract.status !== ContractStatus.DRAFT) {
        throw AppError.conflict('Only DRAFT contracts can be activated', ErrorCode.BUSINESS_RULE_VIOLATION);
      }

      // Lock in canonical order so a concurrently-archived hostel/resident is
      // observed authoritatively and checkout/terminate serialize correctly.
      await this.locks.lockHostel(tx, contract.hostelId);
      await this.locks.lockResident(tx, contract.residentId);
      await this.locks.lockContract(tx, contractId);

      const hostel = await tx.hostel.findFirst({ where: { id: contract.hostelId, organizationId }, select: { status: true } });
      if (!hostel) throw AppError.notFound('Hostel not found');
      if (hostel.status === ArchiveStatus.ARCHIVED) {
        throw AppError.conflict('Hostel is archived; the contract cannot be activated', ErrorCode.BUSINESS_RULE_VIOLATION);
      }
      const resident = await tx.resident.findFirst({ where: { id: contract.residentId, organizationId }, select: { status: true } });
      if (!resident) throw AppError.notFound('Resident not found');
      if (resident.status !== ResidentStatus.ACTIVE) {
        throw AppError.conflict('Resident is not active', ErrorCode.BUSINESS_RULE_VIOLATION);
      }

      await this.assertNoActiveOverlap(tx, organizationId, contract.residentId, contract.startDate, contract.endDate, contractId);

      try {
        const result = await tx.stayContract.updateMany({
          where: { id: contractId, organizationId, status: ContractStatus.DRAFT },
          data: { status: ContractStatus.ACTIVE, version: { increment: 1 } },
        });
        if (result.count === 0) {
          throw AppError.conflict('Contract was modified by another request; refresh and retry', ErrorCode.RESOURCE_VERSION_CONFLICT);
        }
      } catch (err) {
        if (isExclusionViolation(err)) {
          throw AppError.conflict('Resident already has an active contract within this period', ErrorCode.RESIDENT_CONTRACT_OVERLAP);
        }
        throw err;
      }

      const updated = await tx.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
      return toStayContractDto(updated!);
    });
  }

  async terminate(organizationId: string, contractId: string) {
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.stayContract.findFirst({ where: { id: contractId, organizationId }, select: { status: true } });
      if (!contract) throw AppError.notFound('Contract not found');
      if (contract.status === ContractStatus.TERMINATED) {
        const existing = await tx.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
        return toStayContractDto(existing!);
      }
      if (contract.status === ContractStatus.CLOSED) {
        throw AppError.conflict('Closed contract cannot be terminated', ErrorCode.BUSINESS_RULE_VIOLATION);
      }

      // Serialize against a concurrent assignment create (which locks the
      // contract) so the "no active assignments" guard cannot be raced.
      await this.locks.lockContract(tx, contractId);

      const activeAssignments = await tx.bedAssignment.count({
        where: { contractId, organizationId, status: AssignmentStatus.ACTIVE },
      });
      if (activeAssignments > 0) {
        throw AppError.conflict('Contract still has an active bed assignment; end it first', ErrorCode.RESOURCE_HAS_ACTIVE_ASSIGNMENT);
      }

      const result = await tx.stayContract.updateMany({
        where: { id: contractId, organizationId, status: contract.status },
        data: { status: ContractStatus.TERMINATED, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw AppError.conflict('Contract was modified by another request; refresh and retry', ErrorCode.RESOURCE_VERSION_CONFLICT);
      }
      const updated = await tx.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
      return toStayContractDto(updated!);
    });
  }

  /**
   * Checkout: atomically end all active bed assignments for the contract and
   * close the contract. History is preserved — rows are updated, never deleted.
   */
  async checkout(organizationId: string, contractId: string) {
    return this.prisma.$transaction(async (tx) => {
      const today = await businessTodayForOrg(tx, organizationId);
      const endDate = toBusinessDateOnly(today);
      // CAS: only close if still ACTIVE (idempotent for an already-CLOSED contract).
      const closed = await tx.stayContract.updateMany({
        where: { id: contractId, organizationId, status: ContractStatus.ACTIVE },
        data: { status: ContractStatus.CLOSED, endDate, version: { increment: 1 } },
      });
      if (closed.count === 0) {
        const existing = await tx.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
        if (!existing) throw AppError.notFound('Contract not found');
        if (existing.status === ContractStatus.CLOSED) return toStayContractDto(existing);
        throw AppError.conflict('Only ACTIVE contracts can be checked out', ErrorCode.BUSINESS_RULE_VIOLATION);
      }
      await tx.bedAssignment.updateMany({
        where: { contractId, organizationId, status: AssignmentStatus.ACTIVE },
        data: { status: AssignmentStatus.ENDED, endDate, version: { increment: 1 } },
      });
      const updated = await tx.stayContract.findFirst({ where: { id: contractId, organizationId }, select: CONTRACT_SELECT });
      return toStayContractDto(updated!);
    });
  }
}