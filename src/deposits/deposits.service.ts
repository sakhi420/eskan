import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  AssignmentStatus,
  ContractStatus,
  DepositType,
  EntrySide,
  LedgerEntryStatus,
  PaymentMethod,
  ReversalSourceType,
  SyncAction,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { PostingService } from '../common/finance/posting.service';
import { LockService } from '../common/concurrency/lock.service';
import { businessTodayForOrg, toDateOnly } from '../common/date/business-date';
import { canonicalRequestHash } from '../common/idempotency/jcs';
import {
  DepositApplicationDto,
  DepositCreateDto,
  DepositForfeitDto,
  DepositRefundDto,
  ReversalDto,
} from './dto/deposit.dto';

const DEPOSIT_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  residentId: true,
  sourceDepositTransactionId: true,
  type: true,
  status: true,
  amount: true,
  receivedAt: true,
  reason: true,
  actorUserId: true,
  reversedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

const APPLICATION_SELECT = {
  id: true,
  version: true,
  organizationId: true,
  residentId: true,
  depositTransactionId: true,
  chargeId: true,
  paymentId: true,
  allocationId: true,
  status: true,
  amount: true,
  reason: true,
  actorUserId: true,
  createdAt: true,
} as const;

function toISODate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

interface DepositRow {
  id: string;
  version: number;
  organizationId: string;
  residentId: string;
  sourceDepositTransactionId: string | null;
  type: DepositType;
  status: LedgerEntryStatus;
  amount: number;
  receivedAt: Date | null;
  reason: string | null;
  actorUserId: string | null;
  reversedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ApplicationRow {
  id: string;
  version: number;
  organizationId: string;
  residentId: string;
  depositTransactionId: string;
  chargeId: string;
  paymentId: string;
  allocationId: string;
  status: LedgerEntryStatus;
  amount: number;
  reason: string;
  actorUserId: string;
  createdAt: Date;
}

function toDepositDto(row: DepositRow, reversed = row.status === LedgerEntryStatus.REVERSED) {
  return {
    id: row.id,
    version: row.version,
    organizationId: row.organizationId,
    residentId: row.residentId,
    sourceDepositTransactionId: row.sourceDepositTransactionId ?? undefined,
    type: row.type,
    status: reversed ? LedgerEntryStatus.REVERSED : row.status,
    money: { amount: row.amount, currency: 'AFN' },
    receivedAt: row.receivedAt ? toISODate(row.receivedAt) : undefined,
    reason: row.reason ?? undefined,
    actorUserId: row.actorUserId ?? undefined,
    reversedBy: row.reversedById ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toApplicationDto(row: ApplicationRow) {
  return {
    id: row.id,
    version: row.version,
    organizationId: row.organizationId,
    residentId: row.residentId,
    depositTransactionId: row.depositTransactionId,
    chargeId: row.chargeId,
    paymentId: row.paymentId,
    allocationId: row.allocationId,
    status: row.status,
    money: { amount: row.amount, currency: 'AFN' },
    reason: row.reason,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly posting: PostingService,
    private readonly locks: LockService,
  ) {}

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
   * Per-source held balance. DepositTransaction rows are immutable: a void is
   * represented only by a DEPOSIT LedgerReversal. A reversed source receipt
   * contributes zero; reversed REFUNDED/FORFEITED children no longer reduce Held.
   */
  private async sourceHeld(
    tx: Prisma.TransactionClient,
    organizationId: string,
    depositId: string,
  ): Promise<number> {
    const received = await tx.depositTransaction.findFirst({
      where: {
        id: depositId,
        organizationId,
        type: DepositType.RECEIVED,
        status: LedgerEntryStatus.POSTED,
      },
      select: { amount: true },
    });
    if (!received) return 0;

    const sourceReversal = await tx.ledgerReversal.findFirst({
      where: { organizationId, sourceType: ReversalSourceType.DEPOSIT, sourceId: depositId },
      select: { id: true },
    });
    if (sourceReversal) return 0;

    const related = await tx.depositTransaction.findMany({
      where: {
        organizationId,
        sourceDepositTransactionId: depositId,
        status: LedgerEntryStatus.POSTED,
      },
      select: { id: true, type: true, amount: true },
    });
    const relatedReversals = related.length
      ? await tx.ledgerReversal.findMany({
          where: {
            organizationId,
            sourceType: ReversalSourceType.DEPOSIT,
            sourceId: { in: related.map((row) => row.id) },
          },
          select: { sourceId: true },
        })
      : [];
    const reversedIds = new Set(relatedReversals.map((row) => row.sourceId));
    const activeRelated = related.filter((row) => !reversedIds.has(row.id));
    const refunded = activeRelated
      .filter((row) => row.type === DepositType.REFUNDED)
      .reduce((sum, row) => sum + row.amount, 0);
    const forfeited = activeRelated
      .filter((row) => row.type === DepositType.FORFEITED)
      .reduce((sum, row) => sum + row.amount, 0);

    const applied = await tx.depositApplication.aggregate({
      where: { organizationId, depositTransactionId: depositId, status: LedgerEntryStatus.POSTED },
      _sum: { amount: true },
    });

    return received.amount - refunded - forfeited - (applied._sum.amount ?? 0);
  }

  /** Resident-level deposit held = sum of the per-source held balances. */
  private async residentHeld(
    tx: Prisma.TransactionClient,
    organizationId: string,
    residentId: string,
  ): Promise<number> {
    const sources = await tx.depositTransaction.findMany({
      where: {
        organizationId,
        residentId,
        type: DepositType.RECEIVED,
        status: LedgerEntryStatus.POSTED,
      },
      select: { id: true },
    });
    let total = 0;
    for (const s of sources) total += await this.sourceHeld(tx, organizationId, s.id);
    return total;
  }

  async listByResident(organizationId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, organizationId },
      select: { id: true },
    });
    if (!resident) throw AppError.notFound('Resident not found');
    const rows = await this.prisma.depositTransaction.findMany({
      where: { organizationId, residentId },
      orderBy: { createdAt: 'desc' },
      select: DEPOSIT_SELECT,
    });
    const reversals = rows.length
      ? await this.prisma.ledgerReversal.findMany({
          where: {
            organizationId,
            sourceType: ReversalSourceType.DEPOSIT,
            sourceId: { in: rows.map((row) => row.id) },
          },
          select: { sourceId: true },
        })
      : [];
    const reversedIds = new Set(reversals.map((row) => row.sourceId));
    return (rows as unknown as DepositRow[]).map((row) =>
      toDepositDto(row, reversedIds.has(row.id)),
    );
  }

  async receive(
    organizationId: string,
    userId: string,
    residentId: string,
    dto: DepositCreateDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/residents/${residentId}/deposit-transactions`;
    const requestHash = canonicalRequestHash({
      method: 'POST',
      route: '/api/v1/residents/{residentId}/deposit-transactions',
      pathParams: { residentId },
      body: dto,
    });

    return this.idempotency.runAtomic<ReturnType<typeof toDepositDto>>(
      {
        organizationId,
        key: idempotencyKey,
        endpoint,
        userId,
        requestHash,
        statusCode: 201,
        retentionClass: 'PERMANENT',
      },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        await this.locks.lockResident(tx, residentId, organizationId);
        const resident = await tx.resident.findFirst({
          where: { id: residentId, organizationId },
          select: { id: true },
        });
        if (!resident) throw AppError.notFound('Resident not found');

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const deposit = (await tx.depositTransaction.create({
          data: {
            organizationId,
            residentId,
            type: DepositType.RECEIVED,
            amount,
            receivedAt: toDateOnly(dto.receivedAt),
            reason: dto.reason ?? null,
            actorUserId: userId,
          },
          select: DEPOSIT_SELECT,
        })) as unknown as DepositRow;

        await this.posting.audit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'DEPOSIT_RECEIVED',
          entityType: 'DEPOSIT',
          entityId: deposit.id,
          traceId,
          after: {
            businessDate,
            residentId,
            type: DepositType.RECEIVED,
            amount,
          } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'DEPOSIT', deposit.id, deposit.version);
        return toDepositDto(deposit);
      },
      {
        toRecord: (result) => ({ resourceType: 'DEPOSIT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId)
            throw AppError.internal('Idempotency record is missing its deposit reference');
          const row = await this.prisma.depositTransaction.findFirst({
            where: { id: ref.resourceId, organizationId },
            select: DEPOSIT_SELECT,
          });
          if (!row)
            throw AppError.internal('Deposit referenced by idempotency record no longer exists');
          return toDepositDto(row as unknown as DepositRow);
        },
      },
    );
  }

  async refund(
    organizationId: string,
    userId: string,
    depositTransactionId: string,
    dto: DepositRefundDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/deposit-transactions/${depositTransactionId}/refund`;
    const requestHash = canonicalRequestHash({
      method: 'POST',
      route: '/api/v1/deposit-transactions/{depositTransactionId}/refund',
      pathParams: { depositTransactionId },
      body: dto,
    });

    return this.idempotency.runAtomic<ReturnType<typeof toDepositDto>>(
      {
        organizationId,
        key: idempotencyKey,
        endpoint,
        userId,
        requestHash,
        statusCode: 201,
        retentionClass: 'PERMANENT',
      },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        const source = await tx.depositTransaction.findFirst({
          where: { id: depositTransactionId, organizationId },
          select: { id: true, residentId: true, type: true },
        });
        if (!source) throw AppError.notFound('Deposit transaction not found');
        if (source.type !== DepositType.RECEIVED)
          throw AppError.conflict(
            'Only a RECEIVED deposit can be refunded',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        await this.locks.lockResident(tx, source.residentId, organizationId);

        const held = await this.sourceHeld(tx, organizationId, source.id);
        if (amount > held)
          throw AppError.conflict(
            'Refund exceeds the held deposit balance',
            ErrorCode.REFUND_EXCEEDS_DEPOSIT_BALANCE,
          );

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const row = (await tx.depositTransaction.create({
          data: {
            organizationId,
            residentId: source.residentId,
            sourceDepositTransactionId: source.id,
            type: DepositType.REFUNDED,
            amount,
            receivedAt: toDateOnly(businessDate),
            reason: dto.reason,
            actorUserId: userId,
          },
          select: DEPOSIT_SELECT,
        })) as unknown as DepositRow;

        await this.posting.audit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'DEPOSIT_REFUNDED',
          entityType: 'DEPOSIT',
          entityId: row.id,
          traceId,
          after: {
            businessDate,
            residentId: source.residentId,
            sourceDepositId: source.id,
            type: DepositType.REFUNDED,
            amount,
            reason: dto.reason,
          } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'DEPOSIT', row.id, row.version);
        return toDepositDto(row);
      },
      {
        toRecord: (result) => ({ resourceType: 'DEPOSIT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId)
            throw AppError.internal('Idempotency record is missing its deposit reference');
          const row = await this.prisma.depositTransaction.findFirst({
            where: { id: ref.resourceId, organizationId },
            select: DEPOSIT_SELECT,
          });
          if (!row)
            throw AppError.internal('Deposit referenced by idempotency record no longer exists');
          return toDepositDto(row as unknown as DepositRow);
        },
      },
    );
  }

  async forfeit(
    organizationId: string,
    userId: string,
    depositTransactionId: string,
    dto: DepositForfeitDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/deposit-transactions/${depositTransactionId}/forfeit`;
    const requestHash = canonicalRequestHash({
      method: 'POST',
      route: '/api/v1/deposit-transactions/{depositTransactionId}/forfeit',
      pathParams: { depositTransactionId },
      body: dto,
    });

    return this.idempotency.runAtomic<ReturnType<typeof toDepositDto>>(
      {
        organizationId,
        key: idempotencyKey,
        endpoint,
        userId,
        requestHash,
        statusCode: 201,
        retentionClass: 'PERMANENT',
      },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        const source = await tx.depositTransaction.findFirst({
          where: { id: depositTransactionId, organizationId },
          select: { id: true, residentId: true, type: true },
        });
        if (!source) throw AppError.notFound('Deposit transaction not found');
        if (source.type !== DepositType.RECEIVED)
          throw AppError.conflict(
            'Only a RECEIVED deposit can be forfeited',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        await this.locks.lockResident(tx, source.residentId, organizationId);

        const held = await this.sourceHeld(tx, organizationId, source.id);
        if (amount > held)
          throw AppError.conflict(
            'Forfeit exceeds the held deposit balance',
            ErrorCode.DEPOSIT_BALANCE_INSUFFICIENT,
          );

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const row = (await tx.depositTransaction.create({
          data: {
            organizationId,
            residentId: source.residentId,
            sourceDepositTransactionId: source.id,
            type: DepositType.FORFEITED,
            amount,
            receivedAt: toDateOnly(businessDate),
            reason: dto.reason,
            actorUserId: userId,
          },
          select: DEPOSIT_SELECT,
        })) as unknown as DepositRow;

        await this.posting.audit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'DEPOSIT_FORFEITED',
          entityType: 'DEPOSIT',
          entityId: row.id,
          traceId,
          after: {
            businessDate,
            residentId: source.residentId,
            sourceDepositId: source.id,
            type: DepositType.FORFEITED,
            amount,
            reason: dto.reason,
          } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'DEPOSIT', row.id, row.version);
        return toDepositDto(row);
      },
      {
        toRecord: (result) => ({ resourceType: 'DEPOSIT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId)
            throw AppError.internal('Idempotency record is missing its deposit reference');
          const row = await this.prisma.depositTransaction.findFirst({
            where: { id: ref.resourceId, organizationId },
            select: DEPOSIT_SELECT,
          });
          if (!row)
            throw AppError.internal('Deposit referenced by idempotency record no longer exists');
          return toDepositDto(row as unknown as DepositRow);
        },
      },
    );
  }

  async reverse(
    organizationId: string,
    userId: string,
    depositTransactionId: string,
    dto: ReversalDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const endpoint = `/api/v1/deposit-transactions/${depositTransactionId}/reverse`;
    const requestHash = canonicalRequestHash({
      method: 'POST',
      route: '/api/v1/deposit-transactions/{depositTransactionId}/reverse',
      pathParams: { depositTransactionId },
      body: dto,
    });

    return this.idempotency.runAtomic<ReturnType<typeof toDepositDto>>(
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
        await this.locks.lockOrganization(tx, organizationId);
        const pre = await tx.depositTransaction.findFirst({
          where: { id: depositTransactionId, organizationId },
          select: { id: true, residentId: true },
        });
        if (!pre) throw AppError.notFound('Deposit transaction not found');
        await this.locks.lockResident(tx, pre.residentId, organizationId);
        await this.locks.lockDepositTransaction(tx, pre.id, organizationId);

        const deposit = await tx.depositTransaction.findFirst({
          where: { id: depositTransactionId, organizationId },
          // toDepositDto() requires the complete immutable event projection,
          // including createdAt and updatedAt. Keep this selection aligned
          // with DEPOSIT_SELECT so reverse() cannot fail while serializing
          // the successful mutation inside the idempotency transaction.
          select: DEPOSIT_SELECT,
        });
        if (!deposit) throw AppError.notFound('Deposit transaction not found');
        if (deposit.status !== LedgerEntryStatus.POSTED) {
          throw AppError.conflict(
            'Deposit event is not in a reversible posted state',
            ErrorCode.DEPOSIT_ALREADY_REVERSED,
          );
        }
        const priorReversal = await tx.ledgerReversal.findFirst({
          where: { organizationId, sourceType: ReversalSourceType.DEPOSIT, sourceId: deposit.id },
          select: { id: true },
        });
        if (priorReversal)
          throw AppError.conflict(
            'Deposit event is already reversed',
            ErrorCode.DEPOSIT_ALREADY_REVERSED,
          );

        if (deposit.type === DepositType.RECEIVED) {
          const held = await this.sourceHeld(tx, organizationId, deposit.id);
          if (held < deposit.amount) {
            throw AppError.conflict(
              'Reversal of a received deposit requires its dependent events to be reversed first',
              ErrorCode.BUSINESS_RULE_VIOLATION,
            );
          }
        } else {
          if (!deposit.sourceDepositTransactionId) {
            throw AppError.conflict(
              'Refund/forfeit event is missing its source deposit',
              ErrorCode.BUSINESS_RULE_VIOLATION,
            );
          }
          const sourceReversal = await tx.ledgerReversal.findFirst({
            where: {
              organizationId,
              sourceType: ReversalSourceType.DEPOSIT,
              sourceId: deposit.sourceDepositTransactionId,
            },
            select: { id: true },
          });
          if (sourceReversal) {
            throw AppError.conflict(
              'A child deposit event cannot be reversed after its source receipt was reversed',
              ErrorCode.BUSINESS_RULE_VIOLATION,
            );
          }
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);
        // D-02 / section 4.4: the source event is never UPDATEd; this row is immutable.
        const side = deposit.type === DepositType.RECEIVED ? EntrySide.DEBIT : EntrySide.CREDIT;
        const reversal = await tx.ledgerReversal.create({
          data: {
            organizationId,
            residentId: deposit.residentId,
            sourceType: ReversalSourceType.DEPOSIT,
            sourceId: deposit.id,
            side,
            amount: deposit.amount,
            reason: dto.reason,
            actorUserId: userId,
            idempotencyKey,
          },
          select: { id: true },
        });

        await this.posting.audit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'DEPOSIT_REVERSED',
          entityType: 'DEPOSIT',
          entityId: deposit.id,
          traceId,
          after: {
            businessDate,
            reversalId: reversal.id,
            reason: dto.reason,
          } as unknown as Prisma.InputJsonValue,
        });
        // The original deposit row is unchanged; the reversal event has its own sync record.
        await this.emitSync(tx, organizationId, 'LEDGER_REVERSAL', reversal.id, 1);
        return toDepositDto(deposit as unknown as DepositRow, true);
      },
      {
        toRecord: (result) => ({ resourceType: 'DEPOSIT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId)
            throw AppError.internal('Idempotency record is missing its deposit reference');
          const row = await this.prisma.depositTransaction.findFirst({
            where: { id: ref.resourceId, organizationId },
            select: DEPOSIT_SELECT,
          });
          if (!row)
            throw AppError.internal('Deposit referenced by idempotency record no longer exists');
          const reversal = await this.prisma.ledgerReversal.findFirst({
            where: { organizationId, sourceType: ReversalSourceType.DEPOSIT, sourceId: row.id },
            select: { id: true },
          });
          return toDepositDto(row as unknown as DepositRow, Boolean(reversal));
        },
      },
    );
  }

  async apply(
    organizationId: string,
    userId: string,
    residentId: string,
    dto: DepositApplicationDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const endpoint = `/api/v1/residents/${residentId}/deposits/apply`;
    const requestHash = canonicalRequestHash({
      method: 'POST',
      route: '/api/v1/residents/{residentId}/deposits/apply',
      pathParams: { residentId },
      body: dto,
    });

    return this.idempotency.runAtomic<{
      applications: ReturnType<typeof toApplicationDto>[];
      totalApplied: string;
      remainingDepositBalance: string;
    }>(
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
        await this.locks.lockOrganization(tx, organizationId);
        const deposit = await tx.depositTransaction.findFirst({
          where: { id: dto.depositTransactionId, organizationId },
          select: { id: true, residentId: true, type: true, status: true, amount: true },
        });
        if (!deposit) throw AppError.notFound('Deposit transaction not found');
        if (deposit.type !== DepositType.RECEIVED)
          throw AppError.conflict(
            'Only a RECEIVED deposit can be applied',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        if (deposit.status !== LedgerEntryStatus.POSTED)
          throw AppError.conflict('Deposit is not usable', ErrorCode.DEPOSIT_ALREADY_REVERSED);
        if (deposit.residentId !== residentId)
          throw AppError.conflict(
            'Deposit belongs to a different resident',
            ErrorCode.RESIDENT_MISMATCH,
          );

        await this.locks.lockResident(tx, residentId, organizationId);

        const activeContract = await tx.stayContract.findFirst({
          where: { organizationId, residentId, status: ContractStatus.ACTIVE },
          select: { id: true },
        });
        if (activeContract) {
          throw AppError.conflict(
            'Deposit can only be applied after all active contracts are closed or terminated',
            ErrorCode.CHECKOUT_REQUIRED,
          );
        }
        // P1-6 / D-10: absence of an ACTIVE contract alone does NOT prove final checkout
        // (a resident with no contract or only a DRAFT contract is not eligible). The gate
        // fails closed unless a finalized contract exists and no active bed assignment does.
        const finalizedContract = await tx.stayContract.findFirst({
          where: {
            organizationId,
            residentId,
            status: { in: [ContractStatus.CLOSED, ContractStatus.TERMINATED] },
          },
          select: { id: true },
        });
        if (!finalizedContract)
          throw AppError.conflict(
            'Deposit can only be applied after a finalized (closed/terminated) contract',
            ErrorCode.CHECKOUT_REQUIRED,
          );
        const activeAssignment = await tx.bedAssignment.findFirst({
          where: { organizationId, residentId, status: AssignmentStatus.ACTIVE },
          select: { id: true },
        });
        if (activeAssignment)
          throw AppError.conflict(
            'Deposit can only be applied after checkout (no active BedAssignment)',
            ErrorCode.CHECKOUT_REQUIRED,
          );

        const totalNew = dto.charges.reduce((s, c) => s + c.money.amount, 0);
        const held = await this.sourceHeld(tx, organizationId, deposit.id);
        if (totalNew > held)
          throw AppError.conflict(
            'Application exceeds the held deposit balance',
            ErrorCode.DEPOSIT_BALANCE_INSUFFICIENT,
          );

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const applications: ReturnType<typeof toApplicationDto>[] = [];
        const sortedLines = [...dto.charges].sort((a, b) => a.chargeId.localeCompare(b.chargeId));

        for (const line of sortedLines) {
          const charge = await tx.charge.findFirst({
            where: { id: line.chargeId, organizationId },
            select: { id: true, residentId: true, status: true, entrySide: true, amount: true },
          });
          if (!charge) throw AppError.notFound('Charge not found');
          if (charge.residentId !== residentId)
            throw AppError.conflict(
              'Charge belongs to a different resident',
              ErrorCode.RESIDENT_MISMATCH,
            );
          if (charge.status !== LedgerEntryStatus.POSTED)
            throw AppError.conflict('Charge is not usable', ErrorCode.CHARGE_ALREADY_REVERSED);
          if (charge.entrySide !== EntrySide.DEBIT)
            throw AppError.conflict(
              'Only a DEBIT charge is an applicable debt',
              ErrorCode.BUSINESS_RULE_VIOLATION,
            );
          await this.locks.lockCharge(tx, charge.id, organizationId);

          const allocated = await tx.paymentAllocation.aggregate({
            where: { organizationId, chargeId: charge.id },
            _sum: { amount: true },
          });
          const allocRows = await tx.paymentAllocation.findMany({
            where: { organizationId, chargeId: charge.id },
            select: { id: true },
          });
          let released = 0;
          if (allocRows.length > 0) {
            released =
              (
                await tx.allocationRelease.aggregate({
                  where: { organizationId, allocationId: { in: allocRows.map((a) => a.id) } },
                  _sum: { amount: true },
                })
              )._sum.amount ?? 0;
          }
          const outstanding = charge.amount - (allocated._sum.amount ?? 0) + released;
          if (line.money.amount > outstanding)
            throw AppError.conflict(
              'Application exceeds the outstanding charge balance',
              ErrorCode.ALLOCATION_EXCEEDS_CHARGE,
            );

          const payment = await tx.payment.create({
            data: {
              organizationId,
              residentId,
              amount: line.money.amount,
              method: PaymentMethod.DEPOSIT_APPLICATION,
              receivedAt: toDateOnly(businessDate),
            },
            select: { id: true, version: true },
          });
          const allocation = await tx.paymentAllocation.create({
            data: {
              organizationId,
              residentId,
              paymentId: payment.id,
              chargeId: charge.id,
              amount: line.money.amount,
            },
            select: { id: true },
          });
          const application = (await tx.depositApplication.create({
            data: {
              organizationId,
              residentId,
              depositTransactionId: deposit.id,
              chargeId: charge.id,
              paymentId: payment.id,
              allocationId: allocation.id,
              amount: line.money.amount,
              reason: dto.reason,
              actorUserId: userId,
            },
            select: APPLICATION_SELECT,
          })) as unknown as ApplicationRow;

          const chargeUpdated = await tx.charge.update({
            where: { id: charge.id },
            data: { version: { increment: 1 } },
            select: { version: true },
          });

          await this.posting.audit(tx, {
            organizationId,
            actorUserId: userId,
            action: 'DEPOSIT_APPLIED',
            entityType: 'DEPOSIT_APPLICATION',
            entityId: application.id,
            traceId,
            after: {
              businessDate,
              depositTransactionId: deposit.id,
              chargeId: charge.id,
              paymentId: payment.id,
              allocationId: allocation.id,
              amount: line.money.amount,
              reason: dto.reason,
            } as unknown as Prisma.InputJsonValue,
          });
          await this.emitSync(tx, organizationId, 'DEPOSIT_APPLICATION', application.id, 1);
          await this.emitSync(tx, organizationId, 'PAYMENT', payment.id, payment.version);
          await this.emitSync(tx, organizationId, 'ALLOCATION', allocation.id, 1);
          await this.emitSync(tx, organizationId, 'CHARGE', charge.id, chargeUpdated.version);

          applications.push(toApplicationDto(application));
        }

        return {
          applications,
          totalApplied: String(totalNew),
          remainingDepositBalance: String(held - totalNew),
        };
      },
      {
        toRecord: (result) => ({
          applicationIds: result.applications.map((a) => a.id),
          totalApplied: result.totalApplied,
          remainingDepositBalance: result.remainingDepositBalance,
        }),
        fromRecord: async (record) => {
          const ref = record as {
            applicationIds?: string[];
            totalApplied?: string;
            remainingDepositBalance?: string;
          };
          const ids = ref.applicationIds ?? [];
          if (ids.length === 0)
            throw AppError.internal('Idempotency record is missing its application references');
          const rows = await this.prisma.depositApplication.findMany({
            where: { id: { in: ids }, organizationId },
            select: APPLICATION_SELECT,
            orderBy: { createdAt: 'asc' },
          });
          if (rows.length === 0)
            throw AppError.internal(
              'Deposit applications referenced by idempotency record no longer exist',
            );
          return {
            applications: (rows as unknown as ApplicationRow[]).map(toApplicationDto),
            totalApplied: ref.totalApplied ?? '0',
            remainingDepositBalance: ref.remainingDepositBalance ?? '0',
          };
        },
      },
    );
  }

  /**
   * P0-3 / D-02: full reversal of a deposit application (DAPP). In one atomic
   * transaction it (1) releases the linked allocation, (2) reverses the internal
   * DEPOSIT_APPLICATION payment, (3) marks the DepositApplication REVERSED (an
   * append-only compensation that restores Deposit Held exactly once), and (4)
   * records a LedgerReversal with the opposite posting side. The general
   * `refundPayment`/`reversePayment` endpoints reject DAPP, so this is the only
   * valid reversal path for it.
   */
  async reverseApplication(
    organizationId: string,
    userId: string,
    applicationId: string,
    dto: ReversalDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const endpoint = `/api/v1/deposit-applications/${applicationId}/reverse`;
    const requestHash = canonicalRequestHash({
      method: 'POST',
      route: '/api/v1/deposit-applications/{applicationId}/reverse',
      pathParams: { applicationId },
      body: dto,
    });

    return this.idempotency.runAtomic<{
      application: ReturnType<typeof toApplicationDto>;
      paymentId: string;
      allocationId: string;
      reversalId: string;
    }>(
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
        await this.locks.lockOrganization(tx, organizationId);
        const pre = await tx.depositApplication.findFirst({
          where: { id: applicationId, organizationId },
          select: {
            id: true,
            residentId: true,
            depositTransactionId: true,
            chargeId: true,
            paymentId: true,
            allocationId: true,
          },
        });
        if (!pre) throw AppError.notFound('Deposit application not found');

        await this.locks.lockResident(tx, pre.residentId, organizationId);
        await this.locks.lockDepositTransaction(tx, pre.depositTransactionId, organizationId);
        await this.locks.lockCharge(tx, pre.chargeId, organizationId);
        await this.locks.lockPayment(tx, pre.paymentId, organizationId);
        await this.locks.lockAllocation(tx, pre.allocationId, organizationId);
        await this.locks.lockDepositApplication(tx, pre.id, organizationId);

        const application = (await tx.depositApplication.findFirst({
          where: { id: applicationId, organizationId },
          select: APPLICATION_SELECT,
        })) as unknown as ApplicationRow | null;
        if (!application) throw AppError.notFound('Deposit application not found');
        if (application.status === LedgerEntryStatus.REVERSED)
          throw AppError.conflict(
            'Deposit application is already reversed',
            ErrorCode.DEPOSIT_ALREADY_REVERSED,
          );

        const payment = await tx.payment.findFirst({
          where: { id: application.paymentId, organizationId },
          select: { id: true, status: true, method: true, amount: true },
        });
        if (!payment) throw AppError.internal('Linked DEPOSIT_APPLICATION payment not found');
        if (payment.status === LedgerEntryStatus.REVERSED)
          throw AppError.conflict(
            'Linked payment is already reversed',
            ErrorCode.PAYMENT_ALREADY_REVERSED,
          );
        if (
          payment.method !== PaymentMethod.DEPOSIT_APPLICATION ||
          payment.amount !== application.amount
        ) {
          throw AppError.conflict(
            'DepositApplication/payment linkage is inconsistent',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        // Generic allocation endpoints reject DAPP. Fail closed if a second or
        // mismatched allocation was introduced through legacy/direct DB access.
        const paymentAllocations = await tx.paymentAllocation.findMany({
          where: {
            organizationId,
            residentId: application.residentId,
            paymentId: application.paymentId,
          },
          select: { id: true, chargeId: true, amount: true },
        });
        if (
          paymentAllocations.length !== 1 ||
          paymentAllocations[0].id !== application.allocationId ||
          paymentAllocations[0].chargeId !== application.chargeId ||
          paymentAllocations[0].amount !== application.amount
        ) {
          throw AppError.conflict(
            'DepositApplication must own the sole matching allocation for its payment',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const now = new Date();

        const already =
          (
            await tx.allocationRelease.aggregate({
              where: { organizationId, allocationId: application.allocationId },
              _sum: { amount: true },
            })
          )._sum.amount ?? 0;
        const toRelease = application.amount - already;
        if (toRelease > 0) {
          const release = await tx.allocationRelease.create({
            data: {
              organizationId,
              residentId: application.residentId,
              allocationId: application.allocationId,
              amount: toRelease,
              reason: dto.reason,
              actorUserId: userId,
            },
            select: { id: true },
          });
          const chargeUpdated = await tx.charge.update({
            where: { id: application.chargeId },
            data: { version: { increment: 1 } },
            select: { version: true },
          });
          await this.emitSync(tx, organizationId, 'ALLOCATION_RELEASE', release.id, 1);
          await this.emitSync(
            tx,
            organizationId,
            'CHARGE',
            application.chargeId,
            chargeUpdated.version,
          );
        }

        const updatedPayment = await tx.payment.update({
          where: { id: application.paymentId },
          data: {
            status: LedgerEntryStatus.REVERSED,
            reversedById: userId,
            reversalReason: dto.reason,
            reversedAt: now,
            version: { increment: 1 },
          },
          select: { id: true, version: true },
        });

        const updatedApp = (await tx.depositApplication.update({
          where: { id: application.id },
          data: {
            status: LedgerEntryStatus.REVERSED,
            reversedById: userId,
            reversalReason: dto.reason,
            reversedAt: now,
            version: { increment: 1 },
          },
          select: APPLICATION_SELECT,
        })) as unknown as ApplicationRow;

        // Reversal side DEBIT — the opposite of the internal payment's CREDIT posting (D-02).
        const reversal = await tx.ledgerReversal.create({
          data: {
            organizationId,
            residentId: application.residentId,
            sourceType: ReversalSourceType.PAYMENT,
            sourceId: application.paymentId,
            side: EntrySide.DEBIT,
            amount: application.amount,
            reason: dto.reason,
            actorUserId: userId,
            idempotencyKey,
          },
          select: { id: true },
        });

        await this.posting.audit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'DEPOSIT_APPLICATION_REVERSED',
          entityType: 'DEPOSIT_APPLICATION',
          entityId: application.id,
          traceId,
          after: {
            businessDate,
            depositTransactionId: application.depositTransactionId,
            chargeId: application.chargeId,
            paymentId: application.paymentId,
            allocationId: application.allocationId,
            reversalId: reversal.id,
            amount: application.amount,
            reason: dto.reason,
          } as unknown as Prisma.InputJsonValue,
        });

        await this.emitSync(
          tx,
          organizationId,
          'DEPOSIT_APPLICATION',
          updatedApp.id,
          updatedApp.version,
        );
        await this.emitSync(
          tx,
          organizationId,
          'PAYMENT',
          application.paymentId,
          updatedPayment.version,
        );
        await this.emitSync(tx, organizationId, 'LEDGER_REVERSAL', reversal.id, 1);

        return {
          application: toApplicationDto(updatedApp),
          paymentId: application.paymentId,
          allocationId: application.allocationId,
          reversalId: reversal.id,
        };
      },
      {
        toRecord: (result) => ({
          applicationId: result.application.id,
          paymentId: result.paymentId,
          allocationId: result.allocationId,
          reversalId: result.reversalId,
        }),
        fromRecord: async (record) => {
          const ref = record as {
            applicationId?: string;
            paymentId?: string;
            allocationId?: string;
            reversalId?: string;
          };
          if (!ref.applicationId)
            throw AppError.internal('Idempotency record is missing its application reference');
          const row = await this.prisma.depositApplication.findFirst({
            where: { id: ref.applicationId, organizationId },
            select: APPLICATION_SELECT,
          });
          if (!row)
            throw AppError.internal(
              'Deposit application referenced by idempotency record no longer exists',
            );
          return {
            application: toApplicationDto(row as unknown as ApplicationRow),
            paymentId: ref.paymentId ?? '',
            allocationId: ref.allocationId ?? '',
            reversalId: ref.reversalId ?? '',
          };
        },
      },
    );
  }
}
