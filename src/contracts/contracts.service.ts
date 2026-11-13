import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { LockService } from '../common/concurrency/lock.service';
import {
  businessTodayForOrg,
  exclusiveEndForInclusiveLastDay,
  toDateOnly as toBusinessDateOnly,
} from '../common/date/business-date';
import { isUniqueViolation } from '../common/prisma/unique-violation';
import {
  ArchiveStatus,
  AssignmentEndReason,
  AssignmentStatus,
  BillingCycle,
  ContractStatus,
  PackageComponentKind,
  ResidentStatus,
} from '../generated/prisma/enums';
import { ContractDto } from './dto/contract.dto';

const CONTRACT_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  hostelId: true,
  residentId: true,
  contractNumber: true,
  status: true,
  startDate: true,
  endDate: true,
  rentAmount: true,
  billingCycle: true,
  depositAmount: true,
  packageId: true,
  packageSnapshot: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface ComponentSnapshot {
  kind: PackageComponentKind;
  name: string;
  amount: number;
  deductibleOnAbsence: boolean;
}

interface ContractRow {
  id: string;
  version: number;
  organizationId: string;
  hostelId: string;
  residentId: string;
  contractNumber: string;
  status: ContractStatus;
  startDate: Date;
  endDate: Date | null;
  rentAmount: number;
  billingCycle: BillingCycle;
  depositAmount: number | null;
  packageId: string | null;
  packageSnapshot: Prisma.JsonValue | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toISODate(value: Date | string | null): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function toDateOnly(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

function dateMs(d: Date | string): number {
  return new Date(d).getTime();
}

function snapshotToComponents(snapshot: Prisma.JsonValue | null): ComponentSnapshot[] {
  if (!snapshot || !Array.isArray(snapshot)) return [];
  return (snapshot as unknown as ComponentSnapshot[]).map((c) => ({
    kind: c.kind,
    name: c.name,
    amount: c.amount,
    deductibleOnAbsence: c.deductibleOnAbsence,
  }));
}

function toStayContractDto(row: ContractRow) {
  return {
    id: row.id,
    version: row.version,
    organizationId: row.organizationId,
    hostelId: row.hostelId,
    residentId: row.residentId,
    contractNumber: row.contractNumber,
    status: row.status,
    startDate: toISODate(row.startDate),
    endDate: toISODate(row.endDate),
    rent: { amount: row.rentAmount, currency: 'AFN' },
    billingCycle: row.billingCycle,
    deposit: row.depositAmount != null ? { amount: row.depositAmount, currency: 'AFN' } : null,
    packageId: row.packageId,
    packageComponents: snapshotToComponents(row.packageSnapshot),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
      this.prisma.stayContract.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: size,
        select: CONTRACT_SELECT,
      }),
      this.prisma.stayContract.count({ where }),
    ]);
    return {
      items: rows.map(toStayContractDto),
      page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
    };
  }

  async listByResident(organizationId: string, residentId: string) {
    const rows = await this.prisma.stayContract.findMany({
      where: { organizationId, residentId },
      orderBy: { createdAt: 'desc' },
      select: CONTRACT_SELECT,
    });
    return rows.map(toStayContractDto);
  }

  async get(organizationId: string, contractId: string) {
    const contract = await this.prisma.stayContract.findFirst({
      where: { id: contractId, organizationId },
      select: CONTRACT_SELECT,
    });
    if (!contract) throw AppError.notFound('Contract not found');
    return toStayContractDto(contract);
  }
  private async resolve(
    tx: Prisma.TransactionClient,
    organizationId: string,
    dto: ContractDto,
  ): Promise<{ rentAmount: number; snapshot: ComponentSnapshot[] }> {
    // D-02/P1: only MONTHLY billing is implemented in M3a. Accepting YEARLY
    // while the monthly BillingRun silently ignores non-monthly cycles would
    // either double-charge or never charge the resident. Reject YEARLY at the
    // API boundary until a real annual billing workflow exists.
    if (dto.billingCycle === BillingCycle.YEARLY) {
      throw AppError.validation('YEARLY billing is not supported yet; use MONTHLY', [
        {
          field: 'billingCycle',
          code: 'unsupported',
          message: 'only MONTHLY billing is supported',
        },
      ]);
    }
    if (dto.endDate && dto.endDate <= dto.startDate) {
      throw AppError.validation('endDate must be after startDate', [
        { field: 'endDate', code: 'invalid', message: 'must be after startDate' },
      ]);
    }
    const hostel = await tx.hostel.findFirst({
      where: { id: dto.hostelId, organizationId },
      select: { id: true, status: true },
    });
    if (!hostel) throw AppError.notFound('Hostel not found');
    if (hostel.status === ArchiveStatus.ARCHIVED) {
      throw AppError.conflict(
        'Hostel is archived; no new contracts can be created',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    const resident = await tx.resident.findFirst({
      where: { id: dto.residentId, organizationId },
      select: { id: true, status: true },
    });
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
        throw AppError.conflict(
          'Package belongs to a different hostel',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
      snapshot = pkg.components.map((c) => ({
        kind: c.kind,
        name: c.name,
        amount: c.amount,
        deductibleOnAbsence: c.deductibleOnAbsence,
      }));
      const sum = snapshot.reduce((acc, c) => acc + c.amount, 0);
      if (dto.rent.amount !== sum) {
        throw AppError.validation(
          'Contract rent must equal the sum of the selected package components',
          [{ field: 'rent.amount', code: 'mismatch', message: `expected ${sum}` }],
        );
      }
    }
    return { rentAmount: dto.rent.amount, snapshot };
  }

  /** Locks the contract's parents in canonical order before create/update. */
  private async lockContractParents(
    tx: Prisma.TransactionClient,
    organizationId: string,
    hostelId: string,
    residentId: string,
  ): Promise<void> {
    await this.locks.lockHostel(tx, hostelId, organizationId);
    await this.locks.lockResident(tx, residentId, organizationId);
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
    const replay = await this.idempotency.getReplay<ReturnType<typeof toStayContractDto>>(
      organizationId,
      idempotencyKey,
      CREATE_ENDPOINT,
      requestHash,
    );
    if (replay) return replay;

    return this.idempotency.runAtomic<ReturnType<typeof toStayContractDto>>(
      {
        organizationId,
        key: idempotencyKey,
        endpoint: CREATE_ENDPOINT,
        userId,
        requestHash,
        statusCode: 201,
      },
      async (tx) => {
        await this.lockContractParents(tx, organizationId, dto.hostelId, dto.residentId);
        const { rentAmount, snapshot } = await this.resolve(tx, organizationId, dto);
        try {
          const contract = await tx.stayContract.create({
            data: {
              organizationId,
              hostelId: dto.hostelId,
              residentId: dto.residentId,
              contractNumber: generateContractNumber(),
              startDate: toDateOnly(dto.startDate),
              endDate: dto.endDate ? toDateOnly(dto.endDate) : null,
              rentAmount,
              billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY,
              depositAmount: dto.deposit?.amount ?? null,
              packageId: dto.packageId ?? null,
              packageSnapshot: snapshot.length
                ? (snapshot as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
              notes: dto.notes,
            },
            select: CONTRACT_SELECT,
          });
          return toStayContractDto(contract);
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw AppError.conflict(
              'Failed to allocate a unique contract number; retry',
              ErrorCode.BUSINESS_RULE_VIOLATION,
            );
          }
          throw err;
        }
      },
    );
  }
  async update(
    organizationId: string,
    contractId: string,
    expectedVersion: number,
    dto: ContractDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Status/version guard runs before the (expensive/validating) package
      // reconcile so a non-DRAFT contract is always rejected with the correct
      // conflict code instead of an unrelated validation error.
      const existing = await tx.stayContract.findFirst({
        where: { id: contractId, organizationId },
        select: {
          id: true,
          status: true,
          version: true,
          hostelId: true,
          residentId: true,
          billingCycle: true,
        },
      });
      if (!existing) throw AppError.notFound('Contract not found');
      if (existing.status !== ContractStatus.DRAFT) {
        throw AppError.conflict(
          'Only DRAFT contracts can be edited',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
      if (existing.version !== expectedVersion) {
        throw AppError.conflict(
          'Contract was modified by another request; refresh and retry',
          ErrorCode.RESOURCE_VERSION_CONFLICT,
        );
      }
      // Hostel/resident are immutable once a contract exists: re-parenting a
      // DRAFT would resurrect the activate-vs-update race, so the identity of
      // the tenant/bed context must be fixed here (create a new contract to
      // move a resident to another hostel). This also keeps Phase 9 financial
      // allocation anchored to a stable resident/hostel.
      if (dto.hostelId !== existing.hostelId || dto.residentId !== existing.residentId) {
        throw AppError.conflict(
          'Contract hostel/resident cannot be changed after creation; create a new contract',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }

      await this.lockContractParents(tx, organizationId, existing.hostelId, existing.residentId);
      await this.locks.lockContract(tx, contractId, organizationId);
      const { rentAmount, snapshot } = await this.resolve(tx, organizationId, dto);

      // Compare-and-swap update guarded by both status (DRAFT) and version.
      const result = await tx.stayContract.updateMany({
        where: {
          id: contractId,
          organizationId,
          status: ContractStatus.DRAFT,
          version: expectedVersion,
        },
        data: {
          hostelId: existing.hostelId,
          residentId: existing.residentId,
          startDate: toDateOnly(dto.startDate),
          endDate: dto.endDate ? toDateOnly(dto.endDate) : null,
          rentAmount,
          billingCycle: dto.billingCycle ?? existing.billingCycle,
          depositAmount: dto.deposit?.amount ?? null,
          packageId: dto.packageId ?? null,
          packageSnapshot: snapshot.length
            ? (snapshot as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          notes: dto.notes,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw AppError.conflict(
          'Contract was modified by another request; refresh and retry',
          ErrorCode.RESOURCE_VERSION_CONFLICT,
        );
      }

      const updated = await tx.stayContract.findFirst({
        where: { id: contractId, organizationId },
        select: CONTRACT_SELECT,
      });
      return toStayContractDto(updated!);
    });
  }

  async activate(
    organizationId: string,
    contractId: string,
    userId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ) {
    const endpoint = `/api/v1/contracts/${contractId}/activate`;
    const requestHash = this.idempotency.hash({ endpoint, contractId, expectedVersion });
    return this.idempotency.runAtomic<ReturnType<typeof toStayContractDto>>(
      {
        organizationId,
        key: idempotencyKey,
        endpoint,
        userId,
        requestHash,
        statusCode: 200,
        retentionClass: 'PERMANENT',
      },
      async (tx) => {
        // Serialize against Billing (which also takes this advisory Organization
        // lock first) so a contract transition and a billing run for the same
        // organization are strictly ordered and the billable set can never be
        // observed half-way through a lifecycle change.
        await this.locks.lockOrganization(tx, organizationId);

        const contract = await tx.stayContract.findFirst({
          where: { id: contractId, organizationId },
          select: { hostelId: true, residentId: true },
        });
        if (!contract) throw AppError.notFound('Contract not found');

        // Lock in canonical order. Hostel/resident are immutable once created, so
        // the ids read above are stable; the contract is locked last so the
        // authoritative re-read below observes any concurrent update/terminate.
        await this.locks.lockHostel(tx, contract.hostelId, organizationId);
        await this.locks.lockResident(tx, contract.residentId, organizationId);
        await this.locks.lockContract(tx, contractId, organizationId);

        // Authoritative re-read AFTER acquiring the locks: never base the
        // activation decision (status, range, parents) on the pre-lock snapshot.
        const current = await tx.stayContract.findFirst({
          where: { id: contractId, organizationId },
          select: {
            status: true,
            hostelId: true,
            residentId: true,
            startDate: true,
            endDate: true,
            version: true,
            billingCycle: true,
          },
        });
        if (!current) throw AppError.notFound('Contract not found');

        // A legacy YEARLY contract must not be activated: the monthly BillingRun
        // cannot process it, and silently converting it to MONTHLY would corrupt
        // the original billing decision. Require an explicit cycle edit first.
        if (current.billingCycle === BillingCycle.YEARLY) {
          throw AppError.conflict(
            'YEARLY contracts cannot be activated; update the billing cycle to MONTHLY first',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        // Compare-and-swap on the client-observed version: a stale request (new
        // idempotency key, old version) must fail with a version conflict even if
        // the contract has already reached the target state.
        if (current.version !== expectedVersion) {
          throw AppError.conflict(
            'Contract has changed since it was read; refresh and retry',
            ErrorCode.RESOURCE_VERSION_CONFLICT,
          );
        }
        if (current.status !== ContractStatus.DRAFT) {
          throw AppError.conflict(
            'Only DRAFT contracts can be activated',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        const hostel = await tx.hostel.findFirst({
          where: { id: current.hostelId, organizationId },
          select: { status: true },
        });
        if (!hostel) throw AppError.notFound('Hostel not found');
        if (hostel.status === ArchiveStatus.ARCHIVED) {
          throw AppError.conflict(
            'Hostel is archived; the contract cannot be activated',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
        const resident = await tx.resident.findFirst({
          where: { id: current.residentId, organizationId },
          select: { status: true },
        });
        if (!resident) throw AppError.notFound('Resident not found');
        if (resident.status !== ResidentStatus.ACTIVE) {
          throw AppError.conflict('Resident is not active', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        await this.assertNoActiveOverlap(
          tx,
          organizationId,
          current.residentId,
          current.startDate,
          current.endDate,
          contractId,
        );

        try {
          // CAS on status AND version so a concurrent update cannot be silently
          // activated mid-flight.
          const result = await tx.stayContract.updateMany({
            where: {
              id: contractId,
              organizationId,
              status: ContractStatus.DRAFT,
              version: expectedVersion,
            },
            data: { status: ContractStatus.ACTIVE, version: { increment: 1 } },
          });
          if (result.count === 0) {
            throw AppError.conflict(
              'Contract was modified by another request; refresh and retry',
              ErrorCode.RESOURCE_VERSION_CONFLICT,
            );
          }
        } catch (err) {
          if (isExclusionViolation(err)) {
            throw AppError.conflict(
              'Resident already has an active contract within this period',
              ErrorCode.RESIDENT_CONTRACT_OVERLAP,
            );
          }
          throw err;
        }

        const updated = await tx.stayContract.findFirst({
          where: { id: contractId, organizationId },
          select: CONTRACT_SELECT,
        });
        return toStayContractDto(updated!);
      },
    );
  }

  async terminate(
    organizationId: string,
    contractId: string,
    userId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ) {
    const endpoint = `/api/v1/contracts/${contractId}/terminate`;
    const requestHash = this.idempotency.hash({ endpoint, contractId, expectedVersion });
    return this.idempotency.runAtomic<ReturnType<typeof toStayContractDto>>(
      {
        organizationId,
        key: idempotencyKey,
        endpoint,
        userId,
        requestHash,
        statusCode: 200,
        retentionClass: 'PERMANENT',
      },
      async (tx) => {
        // Serialize against a concurrent activate (which also locks the contract).
        await this.locks.lockContract(tx, contractId, organizationId);

        // Authoritative re-read AFTER locking.
        const contract = await tx.stayContract.findFirst({
          where: { id: contractId, organizationId },
          select: { status: true, version: true },
        });
        if (!contract) throw AppError.notFound('Contract not found');

        if (contract.version !== expectedVersion) {
          throw AppError.conflict(
            'Contract has changed since it was read; refresh and retry',
            ErrorCode.RESOURCE_VERSION_CONFLICT,
          );
        }

        // D-01: an ACTIVE contract is only ever closed through the atomic checkout()
        // path (contract + all active assignments in one transaction). terminate()
        // is reserved for cancelling a DRAFT that was never activated.
        if (contract.status === ContractStatus.CLOSED) {
          throw AppError.conflict(
            'Closed contract cannot be terminated',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
        if (contract.status === ContractStatus.ACTIVE) {
          throw AppError.conflict(
            'ACTIVE contract must be closed via checkout, not terminate',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
        if (contract.status !== ContractStatus.DRAFT) {
          throw AppError.conflict(
            'Only DRAFT contracts can be terminated',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        // CAS on DRAFT + version so a concurrent activate cannot be silently
        // terminated mid-flight.
        const result = await tx.stayContract.updateMany({
          where: {
            id: contractId,
            organizationId,
            status: ContractStatus.DRAFT,
            version: expectedVersion,
          },
          data: { status: ContractStatus.TERMINATED, version: { increment: 1 } },
        });
        if (result.count === 0) {
          throw AppError.conflict(
            'Contract was modified by another request; refresh and retry',
            ErrorCode.RESOURCE_VERSION_CONFLICT,
          );
        }
        const updated = await tx.stayContract.findFirst({
          where: { id: contractId, organizationId },
          select: CONTRACT_SELECT,
        });
        return toStayContractDto(updated!);
      },
    );
  }

  /**
   * Checkout: atomically end all active bed assignments for the contract and
   * close the contract. History is preserved — rows are updated, never deleted.
   */
  async checkout(
    organizationId: string,
    contractId: string,
    userId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ) {
    const endpoint = `/api/v1/contracts/${contractId}/checkout`;
    const requestHash = this.idempotency.hash({ endpoint, contractId, expectedVersion });
    return this.idempotency.runAtomic<ReturnType<typeof toStayContractDto>>(
      {
        organizationId,
        key: idempotencyKey,
        endpoint,
        userId,
        requestHash,
        statusCode: 200,
        retentionClass: 'PERMANENT',
      },
      async (tx) => {
        // Serialize against Billing (same advisory Organization lock) so a
        // checkout and a billing run for the same organization are strictly
        // ordered; nothing is billed while a contract is mid-checkout.
        await this.locks.lockOrganization(tx, organizationId);

        // Discover the parent ids so we can lock the canonical chain, then
        // re-read authoritatively before validating and closing.
        const initial = await tx.stayContract.findFirst({
          where: { id: contractId, organizationId },
          select: { hostelId: true, residentId: true },
        });
        if (!initial) throw AppError.notFound('Contract not found');

        await this.locks.lockHostel(tx, initial.hostelId, organizationId);
        await this.locks.lockResident(tx, initial.residentId, organizationId);
        await this.locks.lockContract(tx, contractId, organizationId);

        const contract = await tx.stayContract.findFirst({
          where: { id: contractId, organizationId },
          select: { id: true, status: true, startDate: true, version: true },
        });
        if (!contract) throw AppError.notFound('Contract not found');
        if (contract.version !== expectedVersion) {
          throw AppError.conflict(
            'Contract has changed since it was read; refresh and retry',
            ErrorCode.RESOURCE_VERSION_CONFLICT,
          );
        }
        if (contract.status !== ContractStatus.ACTIVE) {
          throw AppError.conflict(
            'Only ACTIVE contracts can be checked out',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        const today = await businessTodayForOrg(tx, organizationId);
        const endDate = toBusinessDateOnly(exclusiveEndForInclusiveLastDay(today));

        // endDate = lastInclusiveDay + 1, so rejecting when endDate <= startDate
        // means the business day is strictly before the contract start. Same-day
        // checkout stays valid (endDate > startDate); only an inverted range is
        // rejected here.
        if (dateMs(endDate) <= dateMs(contract.startDate)) {
          throw AppError.conflict(
            'Contract cannot be checked out before its start date',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
        const pendingAssignments = await tx.bedAssignment.findMany({
          where: { contractId, organizationId, status: AssignmentStatus.ACTIVE },
          select: { id: true, startDate: true },
        });
        const invalid = pendingAssignments.find((a) => dateMs(endDate) <= dateMs(a.startDate));
        if (invalid) {
          throw AppError.conflict(
            'Contract has an active assignment starting after today; end it first',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        // CAS: only close if still ACTIVE and unmodified (idempotent for an
        // already-CLOSED contract; version-guarded against a concurrent edit).
        const closed = await tx.stayContract.updateMany({
          where: {
            id: contractId,
            organizationId,
            status: ContractStatus.ACTIVE,
            version: expectedVersion,
          },
          data: { status: ContractStatus.CLOSED, endDate, version: { increment: 1 } },
        });
        if (closed.count === 0) {
          throw AppError.conflict(
            'Contract was modified by another request; refresh and retry',
            ErrorCode.RESOURCE_VERSION_CONFLICT,
          );
        }
        await tx.bedAssignment.updateMany({
          where: { contractId, organizationId, status: AssignmentStatus.ACTIVE },
          data: {
            status: AssignmentStatus.ENDED,
            endDate,
            endReason: AssignmentEndReason.CHECKOUT,
            version: { increment: 1 },
          },
        });
        const updated = await tx.stayContract.findFirst({
          where: { id: contractId, organizationId },
          select: CONTRACT_SELECT,
        });
        return toStayContractDto(updated!);
      },
    );
  }
}
