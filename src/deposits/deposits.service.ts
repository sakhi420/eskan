import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  ContractStatus, DepositType, EntrySide, LedgerEntryStatus, PaymentMethod, ReversalSourceType, SyncAction,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { PostingService } from '../common/finance/posting.service';
import { LockService } from '../common/concurrency/lock.service';
import { businessTodayForOrg, toDateOnly } from '../common/date/business-date';
import { canonicalRequestHash } from '../common/idempotency/jcs';
import { DepositApplicationDto, DepositCreateDto, DepositForfeitDto, DepositRefundDto, ReversalDto } from './dto/deposit.dto';

const DEPOSIT_SELECT = {
  id: true, version: true, organizationId: true, residentId: true, type: true, status: true,
  amount: true, receivedAt: true, reason: true, actorUserId: true, reversedById: true, createdAt: true, updatedAt: true,
} as const;

const APPLICATION_SELECT = {
  id: true, organizationId: true, residentId: true, depositTransactionId: true, chargeId: true,
  amount: true, reason: true, actorUserId: true, createdAt: true,
} as const;

function toISODate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

interface DepositRow {
  id: string; version: number; organizationId: string; residentId: string;
  type: DepositType; status: LedgerEntryStatus; amount: number; receivedAt: Date | null;
  reason: string | null; actorUserId: string | null; reversedById: string | null;
  createdAt: Date; updatedAt: Date;
}

interface ApplicationRow {
  id: string; organizationId: string; residentId: string; depositTransactionId: string; chargeId: string;
  amount: number; reason: string; actorUserId: string; createdAt: Date;
}

function toDepositDto(row: DepositRow) {
  return {
    id: row.id, version: row.version, organizationId: row.organizationId, residentId: row.residentId,
    type: row.type, status: row.status,
    money: { amount: row.amount, currency: 'AFN' },
    receivedAt: row.receivedAt ? toISODate(row.receivedAt) : undefined,
    reason: row.reason ?? undefined,
    actorUserId: row.actorUserId ?? undefined,
    reversedBy: row.reversedById ?? undefined,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function toApplicationDto(row: ApplicationRow) {
  return {
    id: row.id, organizationId: row.organizationId, residentId: row.residentId,
    depositTransactionId: row.depositTransactionId, chargeId: row.chargeId,
    money: { amount: row.amount, currency: 'AFN' },
    reason: row.reason, actorUserId: row.actorUserId, createdAt: row.createdAt.toISOString(),
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

  private async emitSync(tx: Prisma.TransactionClient, organizationId: string, entityType: string, entityId: string, entityVersion: number): Promise<void> {
    await this.posting.syncChange(tx, {
      organizationId, entityType, entityId, action: SyncAction.UPSERT, entityVersion,
    });
  }

  /** Deposit Held = valid Received − valid Refunded − valid Forfeited − valid Applied (resident-scoped). */
  private async residentHeld(tx: Prisma.TransactionClient, organizationId: string, residentId: string): Promise<number> {
    const grouped = await tx.depositTransaction.groupBy({
      by: ['type'],
      where: { organizationId, residentId, status: LedgerEntryStatus.POSTED },
      _sum: { amount: true },
    });
    const sum = (t: DepositType): number => grouped.find((x) => x.type === t)?._sum.amount ?? 0;
    const applied = await tx.depositApplication.aggregate({
      where: { organizationId, residentId },
      _sum: { amount: true },
    });
    return sum(DepositType.RECEIVED) - sum(DepositType.REFUNDED) - sum(DepositType.FORFEITED) - (applied._sum.amount ?? 0);
  }

  async listByResident(organizationId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, organizationId }, select: { id: true },
    });
    if (!resident) throw AppError.notFound('Resident not found');
    const rows = await this.prisma.depositTransaction.findMany({
      where: { organizationId, residentId },
      orderBy: { createdAt: 'desc' },
      select: DEPOSIT_SELECT,
    });
    return (rows as unknown as DepositRow[]).map(toDepositDto);
  }

  async receive(organizationId: string, userId: string, residentId: string, dto: DepositCreateDto, idempotencyKey: string, traceId: string) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/residents/${residentId}/deposit-transactions`;
    const requestHash = canonicalRequestHash({ method: 'POST', route: '/api/v1/residents/{residentId}/deposit-transactions', pathParams: { residentId }, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toDepositDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        await this.locks.lockResident(tx, residentId, organizationId);
        const resident = await tx.resident.findFirst({ where: { id: residentId, organizationId }, select: { id: true } });
        if (!resident) throw AppError.notFound('Resident not found');

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const deposit = (await tx.depositTransaction.create({
          data: {
            organizationId, residentId, type: DepositType.RECEIVED, amount,
            receivedAt: toDateOnly(dto.receivedAt), reason: dto.reason ?? null, actorUserId: userId,
          },
          select: DEPOSIT_SELECT,
        })) as unknown as DepositRow;

        await this.posting.audit(tx, {
          organizationId, actorUserId: userId, action: 'DEPOSIT_RECEIVED', entityType: 'DEPOSIT', entityId: deposit.id, traceId,
          after: { businessDate, residentId, type: DepositType.RECEIVED, amount } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'DEPOSIT', deposit.id, deposit.version);
        return toDepositDto(deposit);
      },
      {
        toRecord: (result) => ({ resourceType: 'DEPOSIT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId) throw AppError.internal('Idempotency record is missing its deposit reference');
          const row = await this.prisma.depositTransaction.findFirst({ where: { id: ref.resourceId, organizationId }, select: DEPOSIT_SELECT });
          if (!row) throw AppError.internal('Deposit referenced by idempotency record no longer exists');
          return toDepositDto(row as unknown as DepositRow);
        },
      },
    );
  }

  async refund(organizationId: string, userId: string, depositTransactionId: string, dto: DepositRefundDto, idempotencyKey: string, traceId: string) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/deposit-transactions/${depositTransactionId}/refund`;
    const requestHash = canonicalRequestHash({ method: 'POST', route: '/api/v1/deposit-transactions/{depositTransactionId}/refund', pathParams: { depositTransactionId }, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toDepositDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        const source = await tx.depositTransaction.findFirst({ where: { id: depositTransactionId, organizationId }, select: { id: true, residentId: true, type: true } });
        if (!source) throw AppError.notFound('Deposit transaction not found');
        if (source.type !== DepositType.RECEIVED) throw AppError.conflict('Only a RECEIVED deposit can be refunded', ErrorCode.BUSINESS_RULE_VIOLATION);
        await this.locks.lockResident(tx, source.residentId, organizationId);

        const held = await this.residentHeld(tx, organizationId, source.residentId);
        if (amount > held) throw AppError.conflict('Refund exceeds the held deposit balance', ErrorCode.REFUND_EXCEEDS_DEPOSIT_BALANCE);

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const row = (await tx.depositTransaction.create({
          data: {
            organizationId, residentId: source.residentId, type: DepositType.REFUNDED, amount,
            receivedAt: toDateOnly(businessDate), reason: dto.reason, actorUserId: userId,
          },
          select: DEPOSIT_SELECT,
        })) as unknown as DepositRow;

        await this.posting.audit(tx, {
          organizationId, actorUserId: userId, action: 'DEPOSIT_REFUNDED', entityType: 'DEPOSIT', entityId: row.id, traceId,
          after: { businessDate, residentId: source.residentId, sourceDepositId: source.id, type: DepositType.REFUNDED, amount, reason: dto.reason } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'DEPOSIT', row.id, row.version);
        return toDepositDto(row);
      },
      {
        toRecord: (result) => ({ resourceType: 'DEPOSIT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId) throw AppError.internal('Idempotency record is missing its deposit reference');
          const row = await this.prisma.depositTransaction.findFirst({ where: { id: ref.resourceId, organizationId }, select: DEPOSIT_SELECT });
          if (!row) throw AppError.internal('Deposit referenced by idempotency record no longer exists');
          return toDepositDto(row as unknown as DepositRow);
        },
      },
    );
  }

  async forfeit(organizationId: string, userId: string, depositTransactionId: string, dto: DepositForfeitDto, idempotencyKey: string, traceId: string) {
    const amount = dto.money.amount;
    const endpoint = `/api/v1/deposit-transactions/${depositTransactionId}/forfeit`;
    const requestHash = canonicalRequestHash({ method: 'POST', route: '/api/v1/deposit-transactions/{depositTransactionId}/forfeit', pathParams: { depositTransactionId }, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toDepositDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        const source = await tx.depositTransaction.findFirst({ where: { id: depositTransactionId, organizationId }, select: { id: true, residentId: true, type: true } });
        if (!source) throw AppError.notFound('Deposit transaction not found');
        if (source.type !== DepositType.RECEIVED) throw AppError.conflict('Only a RECEIVED deposit can be forfeited', ErrorCode.BUSINESS_RULE_VIOLATION);
        await this.locks.lockResident(tx, source.residentId, organizationId);

        const held = await this.residentHeld(tx, organizationId, source.residentId);
        if (amount > held) throw AppError.conflict('Forfeit exceeds the held deposit balance', ErrorCode.DEPOSIT_BALANCE_INSUFFICIENT);

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const row = (await tx.depositTransaction.create({
          data: {
            organizationId, residentId: source.residentId, type: DepositType.FORFEITED, amount,
            receivedAt: toDateOnly(businessDate), reason: dto.reason, actorUserId: userId,
          },
          select: DEPOSIT_SELECT,
        })) as unknown as DepositRow;

        await this.posting.audit(tx, {
          organizationId, actorUserId: userId, action: 'DEPOSIT_FORFEITED', entityType: 'DEPOSIT', entityId: row.id, traceId,
          after: { businessDate, residentId: source.residentId, sourceDepositId: source.id, type: DepositType.FORFEITED, amount, reason: dto.reason } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'DEPOSIT', row.id, row.version);
        return toDepositDto(row);
      },
      {
        toRecord: (result) => ({ resourceType: 'DEPOSIT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId) throw AppError.internal('Idempotency record is missing its deposit reference');
          const row = await this.prisma.depositTransaction.findFirst({ where: { id: ref.resourceId, organizationId }, select: DEPOSIT_SELECT });
          if (!row) throw AppError.internal('Deposit referenced by idempotency record no longer exists');
          return toDepositDto(row as unknown as DepositRow);
        },
      },
    );
  }

  async reverse(organizationId: string, userId: string, depositTransactionId: string, dto: ReversalDto, idempotencyKey: string, traceId: string) {
    const endpoint = `/api/v1/deposit-transactions/${depositTransactionId}/reverse`;
    const requestHash = canonicalRequestHash({ method: 'POST', route: '/api/v1/deposit-transactions/{depositTransactionId}/reverse', pathParams: { depositTransactionId }, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toDepositDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 200, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        const pre = await tx.depositTransaction.findFirst({ where: { id: depositTransactionId, organizationId }, select: { id: true, residentId: true } });
        if (!pre) throw AppError.notFound('Deposit transaction not found');
        await this.locks.lockResident(tx, pre.residentId, organizationId);
        await this.locks.lockDepositTransaction(tx, pre.id, organizationId);

        const deposit = await tx.depositTransaction.findFirst({
          where: { id: depositTransactionId, organizationId },
          select: { id: true, version: true, residentId: true, status: true, type: true, amount: true },
        });
        if (!deposit) throw AppError.notFound('Deposit transaction not found');
        if (deposit.status === LedgerEntryStatus.REVERSED) throw AppError.conflict('Deposit event is already reversed', ErrorCode.DEPOSIT_ALREADY_REVERSED);

        if (deposit.type === DepositType.RECEIVED) {
          const held = await this.residentHeld(tx, organizationId, deposit.residentId);
          if (held - deposit.amount < 0) {
            throw AppError.conflict('Reversal would make the held deposit balance negative', ErrorCode.BUSINESS_RULE_VIOLATION);
          }
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const updated = (await tx.depositTransaction.update({
          where: { id: deposit.id },
          data: { status: LedgerEntryStatus.REVERSED, reversedById: userId, reversalReason: dto.reason, reversedAt: new Date(), version: { increment: 1 } },
          select: DEPOSIT_SELECT,
        })) as unknown as DepositRow;

        const reversal = await tx.ledgerReversal.create({
          data: {
            organizationId, residentId: deposit.residentId, sourceType: ReversalSourceType.DEPOSIT, sourceId: deposit.id,
            side: EntrySide.CREDIT, amount: deposit.amount, reason: dto.reason, actorUserId: userId, idempotencyKey,
          },
          select: { id: true },
        });

        await this.posting.audit(tx, {
          organizationId, actorUserId: userId, action: 'DEPOSIT_REVERSED', entityType: 'DEPOSIT', entityId: deposit.id, traceId,
          after: { businessDate, reversalId: reversal.id, reason: dto.reason } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'DEPOSIT', deposit.id, updated.version);
        await this.emitSync(tx, organizationId, 'LEDGER_REVERSAL', reversal.id, 1);
        return toDepositDto(updated);
      },
      {
        toRecord: (result) => ({ resourceType: 'DEPOSIT', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId) throw AppError.internal('Idempotency record is missing its deposit reference');
          const row = await this.prisma.depositTransaction.findFirst({ where: { id: ref.resourceId, organizationId }, select: DEPOSIT_SELECT });
          if (!row) throw AppError.internal('Deposit referenced by idempotency record no longer exists');
          return toDepositDto(row as unknown as DepositRow);
        },
      },
    );
  }

  async apply(organizationId: string, userId: string, residentId: string, dto: DepositApplicationDto, idempotencyKey: string, traceId: string) {
    const endpoint = `/api/v1/residents/${residentId}/deposits/apply`;
    const requestHash = canonicalRequestHash({ method: 'POST', route: '/api/v1/residents/{residentId}/deposits/apply', pathParams: { residentId }, body: dto });

    return this.idempotency.runAtomic<{ applications: ReturnType<typeof toApplicationDto>[]; totalApplied: string; remainingDepositBalance: string }>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 200, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        const deposit = await tx.depositTransaction.findFirst({
          where: { id: dto.depositTransactionId, organizationId },
          select: { id: true, residentId: true, type: true, status: true, amount: true },
        });
        if (!deposit) throw AppError.notFound('Deposit transaction not found');
        if (deposit.type !== DepositType.RECEIVED) throw AppError.conflict('Only a RECEIVED deposit can be applied', ErrorCode.BUSINESS_RULE_VIOLATION);
        if (deposit.status !== LedgerEntryStatus.POSTED) throw AppError.conflict('Deposit is not usable', ErrorCode.DEPOSIT_ALREADY_REVERSED);
        if (deposit.residentId !== residentId) throw AppError.conflict('Deposit belongs to a different resident', ErrorCode.RESIDENT_MISMATCH);

        await this.locks.lockResident(tx, residentId, organizationId);

        const activeContract = await tx.stayContract.findFirst({
          where: { organizationId, residentId, status: ContractStatus.ACTIVE }, select: { id: true },
        });
        if (activeContract) throw AppError.conflict('Deposit can only be applied at final checkout', ErrorCode.CHECKOUT_REQUIRED);

        const totalNew = dto.charges.reduce((s, c) => s + c.money.amount, 0);
        const held = await this.residentHeld(tx, organizationId, residentId);
        if (totalNew > held) throw AppError.conflict('Application exceeds the held deposit balance', ErrorCode.DEPOSIT_BALANCE_INSUFFICIENT);

        const appliedOnDeposit = (await tx.depositApplication.aggregate({ where: { organizationId, depositTransactionId: deposit.id }, _sum: { amount: true } }))._sum.amount ?? 0;
        if (appliedOnDeposit + totalNew > deposit.amount) throw AppError.conflict('Application exceeds the selected deposit balance', ErrorCode.DEPOSIT_BALANCE_INSUFFICIENT);

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const applications: ReturnType<typeof toApplicationDto>[] = [];
        const sortedLines = [...dto.charges].sort((a, b) => a.chargeId.localeCompare(b.chargeId));

        for (const line of sortedLines) {
          const charge = await tx.charge.findFirst({
            where: { id: line.chargeId, organizationId },
            select: { id: true, residentId: true, status: true, entrySide: true, amount: true },
          });
          if (!charge) throw AppError.notFound('Charge not found');
          if (charge.residentId !== residentId) throw AppError.conflict('Charge belongs to a different resident', ErrorCode.RESIDENT_MISMATCH);
          if (charge.status !== LedgerEntryStatus.POSTED) throw AppError.conflict('Charge is not usable', ErrorCode.CHARGE_ALREADY_REVERSED);
          if (charge.entrySide !== EntrySide.DEBIT) throw AppError.conflict('Only a DEBIT charge is an applicable debt', ErrorCode.BUSINESS_RULE_VIOLATION);
          await this.locks.lockCharge(tx, charge.id, organizationId);

          const allocated = await tx.paymentAllocation.aggregate({ where: { organizationId, chargeId: charge.id }, _sum: { amount: true } });
          const allocRows = await tx.paymentAllocation.findMany({ where: { organizationId, chargeId: charge.id }, select: { id: true } });
          let released = 0;
          if (allocRows.length > 0) {
            released = (await tx.allocationRelease.aggregate({ where: { organizationId, allocationId: { in: allocRows.map((a) => a.id) } }, _sum: { amount: true } }))._sum.amount ?? 0;
          }
          const outstanding = charge.amount - (allocated._sum.amount ?? 0) + released;
          if (line.money.amount > outstanding) throw AppError.conflict('Application exceeds the outstanding charge balance', ErrorCode.ALLOCATION_EXCEEDS_CHARGE);

          const payment = await tx.payment.create({
            data: { organizationId, residentId, amount: line.money.amount, method: PaymentMethod.DEPOSIT_APPLICATION, receivedAt: toDateOnly(businessDate) },
            select: { id: true, version: true },
          });
          const allocation = await tx.paymentAllocation.create({
            data: { organizationId, residentId, paymentId: payment.id, chargeId: charge.id, amount: line.money.amount },
            select: { id: true },
          });
          const application = (await tx.depositApplication.create({
            data: { organizationId, residentId, depositTransactionId: deposit.id, chargeId: charge.id, amount: line.money.amount, reason: dto.reason, actorUserId: userId },
            select: APPLICATION_SELECT,
          })) as unknown as ApplicationRow;

          const chargeUpdated = await tx.charge.update({ where: { id: charge.id }, data: { version: { increment: 1 } }, select: { version: true } });

          await this.posting.audit(tx, {
            organizationId, actorUserId: userId, action: 'DEPOSIT_APPLIED', entityType: 'DEPOSIT_APPLICATION', entityId: application.id, traceId,
            after: { businessDate, depositTransactionId: deposit.id, chargeId: charge.id, paymentId: payment.id, allocationId: allocation.id, amount: line.money.amount, reason: dto.reason } as unknown as Prisma.InputJsonValue,
          });
          await this.emitSync(tx, organizationId, 'DEPOSIT_APPLICATION', application.id, 1);
          await this.emitSync(tx, organizationId, 'PAYMENT', payment.id, payment.version);
          await this.emitSync(tx, organizationId, 'CHARGE', charge.id, chargeUpdated.version);

          applications.push(toApplicationDto(application));
        }

        return { applications, totalApplied: String(totalNew), remainingDepositBalance: String(deposit.amount - appliedOnDeposit - totalNew) };
      },
      {
        toRecord: (result) => ({ applicationIds: result.applications.map((a) => a.id) }),
        fromRecord: async (record) => {
          const ids = (record as { applicationIds?: string[] }).applicationIds ?? [];
          if (ids.length === 0) throw AppError.internal('Idempotency record is missing its application references');
          const rows = await this.prisma.depositApplication.findMany({ where: { id: { in: ids }, organizationId }, select: APPLICATION_SELECT, orderBy: { createdAt: 'asc' } });
          if (rows.length === 0) throw AppError.internal('Deposit applications referenced by idempotency record no longer exist');
          const applications = (rows as unknown as ApplicationRow[]).map(toApplicationDto);
          const totalApplied = applications.reduce((s, a) => s + a.money.amount, 0);
          const depositId = (rows[0] as unknown as ApplicationRow).depositTransactionId;
          const depositRow = await this.prisma.depositTransaction.findFirst({ where: { id: depositId, organizationId }, select: { amount: true } });
          const appliedAgg = await this.prisma.depositApplication.aggregate({ where: { organizationId, depositTransactionId: depositId }, _sum: { amount: true } });
          return {
            applications,
            totalApplied: String(totalApplied),
            remainingDepositBalance: depositRow ? String(depositRow.amount - (appliedAgg._sum.amount ?? 0)) : '0',
          };
        },
      },
    );
  }
}