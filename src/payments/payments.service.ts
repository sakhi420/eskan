import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { EntrySide, LedgerEntryStatus, PaymentMethod, ReversalSourceType, SyncAction } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { PostingService } from '../common/finance/posting.service';
import { LockService } from '../common/concurrency/lock.service';
import { businessTodayForOrg, toDateOnly } from '../common/date/business-date';
import { canonicalRequestHash } from '../common/idempotency/jcs';
import { isUniqueViolation } from '../common/prisma/unique-violation';
import { PaymentDto, PaymentRefundDto } from './dto/payment.dto';
import { AllocationReleaseDto, PaymentAllocationDto } from './dto/allocation.dto';
import { ReversalDto } from '../deposits/dto/deposit.dto';

const PAYMENT_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  residentId: true,
  status: true,
  amount: true,
  method: true,
  receivedAt: true,
  receiptNumber: true,
  provisionalReceiptId: true,
  notes: true,
  payerName: true,
  payerPhone: true,
  payerRelation: true,
  reversedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ALLOCATION_SELECT = {
  id: true,
  paymentId: true,
  chargeId: true,
  amount: true,
  createdAt: true,
} as const;

const RELEASE_SELECT = {
  id: true,
  organizationId: true,
  residentId: true,
  allocationId: true,
  amount: true,
  reason: true,
  actorUserId: true,
  createdAt: true,
} as const;

const REFUND_SELECT = {
  id: true,
  organizationId: true,
  residentId: true,
  paymentId: true,
  amount: true,
  reason: true,
  actorUserId: true,
  createdAt: true,
} as const;

const REVERSAL_SELECT = {
  id: true,
  organizationId: true,
  residentId: true,
  sourceType: true,
  sourceId: true,
  side: true,
  amount: true,
  reason: true,
  actorUserId: true,
  idempotencyKey: true,
  createdAt: true,
} as const;

function toISODate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

interface PaymentRow {
  id: string;
  version: number;
  organizationId: string;
  residentId: string;
  status: LedgerEntryStatus;
  amount: number;
  method: PaymentMethod;
  receivedAt: Date;
  receiptNumber: string | null;
  provisionalReceiptId: string | null;
  notes: string | null;
  payerName: string | null;
  payerPhone: string | null;
  payerRelation: string | null;
  reversedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AllocationRow {
  id: string;
  paymentId: string;
  chargeId: string;
  amount: number;
  createdAt: Date;
}

interface ReleaseRow {
  id: string;
  organizationId: string;
  residentId: string;
  allocationId: string;
  amount: number;
  reason: string;
  actorUserId: string;
  createdAt: Date;
}

interface RefundRow {
  id: string; organizationId: string; residentId: string; paymentId: string;
  amount: number; reason: string; actorUserId: string; createdAt: Date;
}

interface ReversalRow {
  id: string; organizationId: string; residentId: string | null; sourceType: ReversalSourceType; sourceId: string;
  side: EntrySide; amount: number; reason: string; actorUserId: string; idempotencyKey: string; createdAt: Date;
}

/**
 * Stable, sortable, organization-internal receipt number: the server-issued
 * counter zero-padded to a fixed width (no year/org/prefix/date components, per
 * the execution directive). The underlying counter is an INT32, so 10 digits
 * cover the entire range while keeping lexicographic order == numeric order.
 */
function formatReceiptNumber(counter: number): string {
  return String(counter).padStart(10, '0');
}

function toPaymentDto(row: PaymentRow) {
  return {
    id: row.id,
    version: row.version,
    organizationId: row.organizationId,
    residentId: row.residentId,
    status: row.status,
    money: { amount: row.amount, currency: 'AFN' },
    method: row.method,
    receivedAt: toISODate(row.receivedAt),
    receiptNumber: row.receiptNumber ?? undefined,
    provisionalReceiptId: row.provisionalReceiptId ?? undefined,
    provisionalReceipt: row.provisionalReceiptId
      ? { provisionalReceiptId: row.provisionalReceiptId, officialReceiptNumber: row.receiptNumber, status: 'ISSUED' }
      : undefined,
    notes: row.notes ?? undefined,
    payerName: row.payerName ?? undefined,
    payerPhone: row.payerPhone ?? undefined,
    payerRelation: row.payerRelation ?? undefined,
    reversedBy: row.reversedById ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAllocationDto(row: AllocationRow) {
  return {
    id: row.id,
    paymentId: row.paymentId,
    chargeId: row.chargeId,
    money: { amount: row.amount, currency: 'AFN' },
    createdAt: row.createdAt.toISOString(),
  };
}

function toReleaseDto(row: ReleaseRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    residentId: row.residentId,
    allocationId: row.allocationId,
    money: { amount: row.amount, currency: 'AFN' },
    reason: row.reason,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRefundDto(row: RefundRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    residentId: row.residentId,
    paymentId: row.paymentId,
    money: { amount: row.amount, currency: 'AFN' },
    reason: row.reason,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toReversalDto(row: ReversalRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    residentId: row.residentId ?? undefined,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    side: row.side,
    money: { amount: row.amount, currency: 'AFN' },
    reason: row.reason,
    actorUserId: row.actorUserId,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly posting: PostingService,
    private readonly locks: LockService,
  ) {}

  /** Atomically reserves the next org-scoped receipt number inside the posting transaction. */
  private async issueReceiptNumber(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ counter: number }>>`
      INSERT INTO "receipt_counters" ("organization_id", "counter", "updated_at")
      VALUES (${organizationId}, 1, now())
      ON CONFLICT ("organization_id")
      DO UPDATE SET "counter" = "receipt_counters"."counter" + 1, "updated_at" = now()
      RETURNING "counter"
    `;
    return formatReceiptNumber(Number(rows[0].counter));
  }

  private async emitSync(
    tx: Prisma.TransactionClient,
    organizationId: string,
    entityType: string,
    entityId: string,
    entityVersion: number,
  ): Promise<void> {
    await this.posting.syncChange(tx, {
      organizationId,
      entityType,
      entityId,
      action: SyncAction.UPSERT,
      entityVersion,
    });
  }

  /**
   * Canonical usable balance of a payment (D-02/D-18): the amount minus every
   * still-applied allocation, plus released allocation amounts, minus refunds
   * already issued. This single formula is used by allocate, refund, reverse and
   * replay so a refund is never double-counted and can never free up the same
   * amount twice.
   */
  private async unappliedBalance(
    tx: Prisma.TransactionClient,
    organizationId: string,
    paymentId: string,
    paymentAmount: number,
  ): Promise<number> {
    const allocated = await tx.paymentAllocation.aggregate({
      where: { organizationId, paymentId },
      _sum: { amount: true },
    });
    const released = await this.releasedForPayment(tx, organizationId, paymentId);
    const refunded = await tx.paymentRefund.aggregate({
      where: { organizationId, paymentId },
      _sum: { amount: true },
    });
    return paymentAmount - (allocated._sum.amount ?? 0) + released - (refunded._sum.amount ?? 0);
  }

  private async releasedForPayment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    paymentId: string,
  ): Promise<number> {
    const allocations = await tx.paymentAllocation.findMany({
      where: { organizationId, paymentId },
      select: { id: true },
    });
    if (allocations.length === 0) return 0;
    const agg = await tx.allocationRelease.aggregate({
      where: { organizationId, allocationId: { in: allocations.map((a) => a.id) } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  /** Outstanding (payable) balance of a DEBIT charge = amount - allocated + released. */
  private async outstandingBalance(
    tx: Prisma.TransactionClient,
    organizationId: string,
    chargeId: string,
    chargeAmount: number,
  ): Promise<number> {
    const allocated = await tx.paymentAllocation.aggregate({
      where: { organizationId, chargeId },
      _sum: { amount: true },
    });
    const allocations = await tx.paymentAllocation.findMany({
      where: { organizationId, chargeId },
      select: { id: true },
    });
    let released = 0;
    if (allocations.length > 0) {
      const agg = await tx.allocationRelease.aggregate({
        where: { organizationId, allocationId: { in: allocations.map((a) => a.id) } },
        _sum: { amount: true },
      });
      released = agg._sum.amount ?? 0;
    }
    return chargeAmount - (allocated._sum.amount ?? 0) + released;
  }

  async createPayment(
    organizationId: string,
    userId: string,
    dto: PaymentDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const amount = dto.money.amount;
    const endpoint = '/api/v1/payments';
    const requestHash = canonicalRequestHash({ method: 'POST', route: endpoint, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toPaymentDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        await this.locks.lockResident(tx, dto.residentId, organizationId);

        const resident = await tx.resident.findFirst({
          where: { id: dto.residentId, organizationId },
          select: { id: true },
        });
        if (!resident) throw AppError.notFound('Resident not found');

        // P0-2: DEPOSIT_APPLICATION is internal-only; the normal receipt path must
        // never accept it (defense-in-depth beyond the DTO/OpenAPI restriction).
        if (dto.method === PaymentMethod.DEPOSIT_APPLICATION) {
          throw AppError.conflict('DEPOSIT_APPLICATION is an internal settlement method and cannot be used for a cash receipt', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const receiptNumber = await this.issueReceiptNumber(tx, organizationId);
        const businessDate = await businessTodayForOrg(tx, organizationId);

        let payment: PaymentRow;
        try {
          payment = (await tx.payment.create({
            data: {
              organizationId,
              residentId: dto.residentId,
              amount,
              method: dto.method,
              receivedAt: toDateOnly(dto.receivedAt),
              receiptNumber,
              notes: dto.notes ?? null,
              payerName: dto.payerName ?? null,
              payerPhone: dto.payerPhone ?? null,
              payerRelation: dto.payerRelation ?? null,
              provisionalReceiptId: dto.provisionalReceiptId ?? null,
            },
            select: PAYMENT_SELECT,
          })) as unknown as PaymentRow;
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw AppError.conflict('Receipt number was already issued', ErrorCode.DUPLICATE_RECEIPT_NUMBER);
          }
          throw err;
        }

        await this.posting.audit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'PAYMENT_CREATED',
          entityType: 'PAYMENT',
          entityId: payment.id,
          traceId,
          after: {
            businessDate,
            receiptNumber,
            amount,
            method: payment.method,
            provisionalReceiptId: payment.provisionalReceiptId,
          } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'PAYMENT', payment.id, payment.version);

        return toPaymentDto(payment);
      },
      {
        toRecord: (result) => ({ resourceType: 'PAYMENT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId) {
            throw AppError.internal('Idempotency record is missing its payment reference');
          }
          return this.getPayment(organizationId, ref.resourceId);
        },
      },
    );
  }

  async getPayment(organizationId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId },
      select: PAYMENT_SELECT,
    });
    if (!payment) throw AppError.notFound('Payment not found');
    return toPaymentDto(payment as unknown as PaymentRow);
  }

  async listPayments(organizationId: string, page: number, size: number, residentId?: string) {
    const where: Prisma.PaymentWhereInput = { organizationId, ...(residentId ? { residentId } : {}) };
    const skip = (page - 1) * size;
    const [rows, totalElements] = await this.prisma.$transaction([
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size, select: PAYMENT_SELECT }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      items: (rows as unknown as PaymentRow[]).map(toPaymentDto),
      page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
    };
  }

  async listResidentPayments(organizationId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, organizationId },
      select: { id: true },
    });
    if (!resident) throw AppError.notFound('Resident not found');
    const rows = await this.prisma.payment.findMany({
      where: { organizationId, residentId },
      orderBy: { createdAt: 'desc' },
      select: PAYMENT_SELECT,
    });
    return (rows as unknown as PaymentRow[]).map(toPaymentDto);
  }

  async listAllocations(organizationId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId },
      select: { id: true },
    });
    if (!payment) throw AppError.notFound('Payment not found');
    const rows = await this.prisma.paymentAllocation.findMany({
      where: { organizationId, paymentId },
      orderBy: { createdAt: 'asc' },
      select: ALLOCATION_SELECT,
    });
    return (rows as unknown as AllocationRow[]).map(toAllocationDto);
  }

  async createAllocation(
    organizationId: string,
    userId: string,
    paymentId: string,
    dto: PaymentAllocationDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/payments/${paymentId}/allocations`;
    const requestHash = canonicalRequestHash({
      method: 'POST',
      route: '/api/v1/payments/{paymentId}/allocations',
      pathParams: { paymentId },
      body: dto,
    });

    return this.idempotency.runAtomic<ReturnType<typeof toAllocationDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        // Canonical financial lock order (Organization -> Resident -> Charge -> Payment).
        await this.locks.lockOrganization(tx, organizationId);

        const pre = await tx.payment.findFirst({
          where: { id: paymentId, organizationId },
          select: { id: true, residentId: true },
        });
        if (!pre) throw AppError.notFound('Payment not found');

        await this.locks.lockResident(tx, pre.residentId, organizationId);

        const chargePre = await tx.charge.findFirst({
          where: { id: dto.chargeId, organizationId },
          select: { id: true, residentId: true },
        });
        if (!chargePre) throw AppError.notFound('Charge not found');
        if (chargePre.residentId !== pre.residentId) {
          throw AppError.conflict('Charge belongs to a different resident', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        await this.locks.lockCharge(tx, chargePre.id, organizationId);
        await this.locks.lockPayment(tx, pre.id, organizationId);

        // Re-read balances under the held locks (never on a pre-lock stale read).
        const payment = await tx.payment.findFirst({
          where: { id: paymentId, organizationId },
          select: { id: true, residentId: true, status: true, amount: true, method: true },
        });
        if (!payment) throw AppError.notFound('Payment not found');
        if (payment.status !== LedgerEntryStatus.POSTED) {
          throw AppError.conflict('Payment is not usable', ErrorCode.PAYMENT_ALREADY_REVERSED);
        }
        // DAPP is a closed internal settlement and cannot be reallocated.
        if (payment.method === PaymentMethod.DEPOSIT_APPLICATION) {
          throw AppError.conflict(
            'Deposit-application payments cannot be allocated through the normal payment endpoint',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        const charge = await tx.charge.findFirst({
          where: { id: dto.chargeId, organizationId },
          select: { id: true, residentId: true, status: true, entrySide: true, amount: true },
        });
        if (!charge) throw AppError.notFound('Charge not found');
        if (charge.status !== LedgerEntryStatus.POSTED) {
          throw AppError.conflict('Charge is not usable', ErrorCode.CHARGE_ALREADY_REVERSED);
        }
        if (charge.entrySide !== EntrySide.DEBIT) {
          throw AppError.conflict('Only a DEBIT charge is an allocatable debt', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const unapplied = await this.unappliedBalance(tx, organizationId, paymentId, payment.amount);
        if (amount > unapplied) {
          throw AppError.conflict('Allocation exceeds the unapplied payment balance', ErrorCode.ALLOCATION_EXCEEDS_PAYMENT);
        }
        const outstanding = await this.outstandingBalance(tx, organizationId, charge.id, charge.amount);
        if (amount > outstanding) {
          throw AppError.conflict('Allocation exceeds the outstanding charge balance', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const allocation = await tx.paymentAllocation.create({
          data: {
            organizationId,
            residentId: payment.residentId,
            paymentId,
            chargeId: charge.id,
            amount,
          },
          select: ALLOCATION_SELECT,
        });

        // Allocation changes both the payment's and the charge's balance; bump
        // their versions so offline clients receive the new balance in sync.
        const payUpdated = await tx.payment.update({
          where: { id: paymentId },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        const chargeUpdated = await tx.charge.update({
          where: { id: charge.id },
          data: { version: { increment: 1 } },
          select: { version: true },
        });

        await this.posting.audit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'ALLOCATION_CREATED',
          entityType: 'ALLOCATION',
          entityId: allocation.id,
          traceId,
          after: { businessDate, paymentId, chargeId: charge.id, amount } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'ALLOCATION', allocation.id, 1);
        await this.emitSync(tx, organizationId, 'PAYMENT', paymentId, payUpdated.version);
        await this.emitSync(tx, organizationId, 'CHARGE', charge.id, chargeUpdated.version);

        return toAllocationDto(allocation as unknown as AllocationRow);
      },
    );
  }

  async releaseAllocation(
    organizationId: string,
    userId: string,
    allocationId: string,
    dto: AllocationReleaseDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/allocations/${allocationId}/release`;
    const requestHash = canonicalRequestHash({
      method: 'POST',
      route: '/api/v1/allocations/{allocationId}/release',
      pathParams: { allocationId },
      body: dto,
    });

    return this.idempotency.runAtomic<ReturnType<typeof toReleaseDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 200, retentionClass: 'PERMANENT' },
      async (tx) => {
        // Read ownership ids without a lock, then re-lock in canonical order and
        // re-read the allocation under the held locks (directive section 5).
        const pre = await tx.paymentAllocation.findFirst({
          where: { id: allocationId, organizationId },
          select: { id: true, residentId: true, paymentId: true, chargeId: true },
        });
        if (!pre) throw AppError.notFound('Allocation not found');

        await this.locks.lockOrganization(tx, organizationId);
        await this.locks.lockResident(tx, pre.residentId, organizationId);
        await this.locks.lockCharge(tx, pre.chargeId, organizationId);
        await this.locks.lockPayment(tx, pre.paymentId, organizationId);
        await this.locks.lockAllocation(tx, pre.id, organizationId);

        const allocation = await tx.paymentAllocation.findFirst({
          where: { id: allocationId, organizationId },
          select: { id: true, residentId: true, paymentId: true, chargeId: true, amount: true },
        });
        if (!allocation) throw AppError.notFound('Allocation not found');

        const payment = await tx.payment.findFirst({
          where: { id: allocation.paymentId, organizationId },
          select: { id: true, status: true, method: true },
        });
        if (!payment) throw AppError.notFound('Payment not found');
        if (payment.status !== LedgerEntryStatus.POSTED) {
          throw AppError.conflict('Payment is not usable', ErrorCode.PAYMENT_ALREADY_REVERSED);
        }
        // Generic release must not detach a DAPP from its one settlement.
        if (payment.method === PaymentMethod.DEPOSIT_APPLICATION) {
          throw AppError.conflict(
            'Deposit-application allocations can only be released by reversing the DepositApplication',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        const releasedTotal = await tx.allocationRelease.aggregate({
          where: { organizationId, allocationId },
          _sum: { amount: true },
        });
        const alreadyReleased = releasedTotal._sum.amount ?? 0;
        if (alreadyReleased + amount > allocation.amount) {
          throw AppError.conflict('Release exceeds the allocation amount', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const release = (await tx.allocationRelease.create({
          data: {
            organizationId,
            residentId: allocation.residentId,
            allocationId: allocation.id,
            amount,
            reason: dto.reason,
            actorUserId: userId,
          },
          select: RELEASE_SELECT,
        })) as unknown as ReleaseRow;

        // Release changes the payment's and charge's balance; bump their versions.
        const payUpdated = await tx.payment.update({
          where: { id: allocation.paymentId },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        const chargeUpdated = await tx.charge.update({
          where: { id: allocation.chargeId },
          data: { version: { increment: 1 } },
          select: { version: true },
        });

        await this.posting.audit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'ALLOCATION_RELEASED',
          entityType: 'ALLOCATION_RELEASE',
          entityId: release.id,
          traceId,
          after: { businessDate, allocationId: allocation.id, amount, reason: dto.reason } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'ALLOCATION_RELEASE', release.id, 1);
        await this.emitSync(tx, organizationId, 'PAYMENT', allocation.paymentId, payUpdated.version);
        await this.emitSync(tx, organizationId, 'CHARGE', allocation.chargeId, chargeUpdated.version);

        return toReleaseDto(release);
      },
    );
  }

  async refundPayment(organizationId: string, userId: string, paymentId: string, dto: PaymentRefundDto, idempotencyKey: string, traceId: string) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/payments/${paymentId}/refund`;
    const requestHash = canonicalRequestHash({ method: 'POST', route: '/api/v1/payments/{paymentId}/refund', pathParams: { paymentId }, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toRefundDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        const pre = await tx.payment.findFirst({ where: { id: paymentId, organizationId }, select: { id: true, residentId: true } });
        if (!pre) throw AppError.notFound('Payment not found');
        await this.locks.lockResident(tx, pre.residentId, organizationId);
        await this.locks.lockPayment(tx, pre.id, organizationId);

        const payment = await tx.payment.findFirst({
          where: { id: paymentId, organizationId },
          select: { id: true, residentId: true, status: true, amount: true, method: true },
        });
        if (!payment) throw AppError.notFound('Payment not found');
        if (payment.status !== LedgerEntryStatus.POSTED) throw AppError.conflict('Payment is not usable', ErrorCode.PAYMENT_ALREADY_REVERSED);

        // P0-3/P1-4: a DEPOSIT_APPLICATION settlement payment carries no real cash;
        // it can only be reversed through the dedicated deposit-application flow.
        if (payment.method === PaymentMethod.DEPOSIT_APPLICATION) {
          throw AppError.conflict('Internal settlement payments cannot be cash-refunded', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const unapplied = await this.unappliedBalance(tx, organizationId, paymentId, payment.amount);
        if (amount > unapplied) throw AppError.conflict('Refund exceeds the unallocated payment balance', ErrorCode.PAYMENT_REFUND_EXCEEDS_UNALLOCATED);

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const refund = (await tx.paymentRefund.create({
          data: { organizationId, residentId: payment.residentId, paymentId, amount, reason: dto.reason, actorUserId: userId },
          select: REFUND_SELECT,
        })) as unknown as RefundRow;

        const payUpdated = await tx.payment.update({ where: { id: paymentId }, data: { version: { increment: 1 } }, select: { version: true } });

        await this.posting.audit(tx, {
          organizationId, actorUserId: userId, action: 'PAYMENT_REFUNDED', entityType: 'PAYMENT_REFUND', entityId: refund.id, traceId,
          after: { businessDate, paymentId, amount, reason: dto.reason } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'PAYMENT_REFUND', refund.id, 1);
        await this.emitSync(tx, organizationId, 'PAYMENT', paymentId, payUpdated.version);
        return toRefundDto(refund);
      },
      {
        toRecord: (result) => ({ resourceType: 'PAYMENT_REFUND', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId) throw AppError.internal('Idempotency record is missing its refund reference');
          const row = await this.prisma.paymentRefund.findFirst({ where: { id: ref.resourceId, organizationId }, select: REFUND_SELECT });
          if (!row) throw AppError.internal('Refund referenced by idempotency record no longer exists');
          return toRefundDto(row as unknown as RefundRow);
        },
      },
    );
  }

  async reversePayment(organizationId: string, userId: string, paymentId: string, dto: ReversalDto, idempotencyKey: string, traceId: string) {
    const endpoint = `/api/v1/payments/${paymentId}/reverse`;
    const requestHash = canonicalRequestHash({ method: 'POST', route: '/api/v1/payments/{paymentId}/reverse', pathParams: { paymentId }, body: dto });

    return this.idempotency.runAtomic<{ payment: ReturnType<typeof toPaymentDto>; releases: ReturnType<typeof toReleaseDto>[]; reversal: ReturnType<typeof toReversalDto> }>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 200, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        const pre = await tx.payment.findFirst({ where: { id: paymentId, organizationId }, select: { id: true, residentId: true } });
        if (!pre) throw AppError.notFound('Payment not found');
        await this.locks.lockResident(tx, pre.residentId, organizationId);
        await this.locks.lockPayment(tx, pre.id, organizationId);

        const payment = (await tx.payment.findFirst({ where: { id: paymentId, organizationId }, select: PAYMENT_SELECT })) as unknown as PaymentRow | null;
        if (!payment) throw AppError.notFound('Payment not found');
        if (payment.status === LedgerEntryStatus.REVERSED) throw AppError.conflict('Payment is already reversed', ErrorCode.PAYMENT_ALREADY_REVERSED);

        // P0-3: internal settlement payments (DEPOSIT_APPLICATION) are reversed only
        // through the dedicated deposit-application reversal flow, never here.
        if (payment.method === PaymentMethod.DEPOSIT_APPLICATION) {
          throw AppError.conflict('Deposit-application payments must be reversed via the deposit application endpoint', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const refundCount = await tx.paymentRefund.count({ where: { organizationId, paymentId } });
        if (refundCount > 0) throw AppError.conflict('Payment has refunds and cannot be voided until those are resolved', ErrorCode.BUSINESS_RULE_VIOLATION);

        const businessDate = await businessTodayForOrg(tx, organizationId);

        // Release every active allocation first (append-only), in canonical charge order.
        const allocations = (await tx.paymentAllocation.findMany({ where: { organizationId, paymentId }, select: ALLOCATION_SELECT, orderBy: { chargeId: 'asc' } })) as unknown as AllocationRow[];
        const releases: ReturnType<typeof toReleaseDto>[] = [];
        for (const alloc of allocations) {
          const already = (await tx.allocationRelease.aggregate({ where: { organizationId, allocationId: alloc.id }, _sum: { amount: true } }))._sum.amount ?? 0;
          const toRelease = alloc.amount - already;
          if (toRelease <= 0) continue;
          const release = (await tx.allocationRelease.create({
            data: { organizationId, residentId: payment.residentId, allocationId: alloc.id, amount: toRelease, reason: dto.reason, actorUserId: userId },
            select: RELEASE_SELECT,
          })) as unknown as ReleaseRow;
          releases.push(toReleaseDto(release));
          const chargeUpdated = await tx.charge.update({ where: { id: alloc.chargeId }, data: { version: { increment: 1 } }, select: { version: true } });
          await this.emitSync(tx, organizationId, 'ALLOCATION_RELEASE', release.id, 1);
          await this.emitSync(tx, organizationId, 'CHARGE', alloc.chargeId, chargeUpdated.version);
        }

        const updated = (await tx.payment.update({
          where: { id: paymentId },
          data: { status: LedgerEntryStatus.REVERSED, reversedById: userId, reversalReason: dto.reason, reversedAt: new Date(), version: { increment: 1 } },
          select: PAYMENT_SELECT,
        })) as unknown as PaymentRow;

        const reversal = (await tx.ledgerReversal.create({
          data: {
            organizationId, residentId: payment.residentId, sourceType: ReversalSourceType.PAYMENT, sourceId: paymentId,
            side: EntrySide.DEBIT, amount: payment.amount, reason: dto.reason, actorUserId: userId, idempotencyKey,
          },
          select: REVERSAL_SELECT,
        })) as unknown as ReversalRow;

        await this.posting.audit(tx, {
          organizationId, actorUserId: userId, action: 'PAYMENT_REVERSED', entityType: 'PAYMENT', entityId: paymentId, traceId,
          after: { businessDate, reversalId: reversal.id, reason: dto.reason, releasedCount: releases.length } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'PAYMENT', paymentId, updated.version);
        await this.emitSync(tx, organizationId, 'LEDGER_REVERSAL', reversal.id, 1);

        return { payment: toPaymentDto(updated), releases, reversal: toReversalDto(reversal) };
      },
      {
        toRecord: (result) => ({
          paymentId: result.payment.id,
          releaseIds: result.releases.map((r) => r.id),
          reversalId: result.reversal.id,
        }),
        fromRecord: async (record) => {
          const ref = record as { paymentId?: string; releaseIds?: string[]; reversalId?: string };
          if (!ref.paymentId) throw AppError.internal('Idempotency record is missing its payment reference');
          const row = await this.prisma.payment.findFirst({ where: { id: ref.paymentId, organizationId }, select: PAYMENT_SELECT });
          if (!row) throw AppError.internal('Payment referenced by idempotency record no longer exists');
          const releaseIds = ref.releaseIds ?? [];
          const relRows = releaseIds.length
            ? await this.prisma.allocationRelease.findMany({ where: { organizationId, id: { in: releaseIds } }, select: RELEASE_SELECT, orderBy: { createdAt: 'asc' } })
            : [];
          const revRow = ref.reversalId
            ? await this.prisma.ledgerReversal.findFirst({ where: { organizationId, id: ref.reversalId }, select: REVERSAL_SELECT })
            : null;
          return {
            payment: toPaymentDto(row as unknown as PaymentRow),
            releases: (relRows as unknown as ReleaseRow[]).map(toReleaseDto),
            reversal: revRow ? toReversalDto(revRow as unknown as ReversalRow) : ({} as ReturnType<typeof toReversalDto>),
          };
        },
      },
    );
  }
}