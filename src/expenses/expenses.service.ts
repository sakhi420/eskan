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
import { ExpenseCreateDto } from './dto/expense.dto';
import { ReversalDto } from '../deposits/dto/deposit.dto';

const EXPENSE_SELECT = {
  id: true, version: true, organizationId: true, hostelId: true, category: true, status: true,
  amount: true, spentAt: true, paymentMethod: true, description: true, actorUserId: true, reversedById: true,
  createdAt: true, updatedAt: true,
} as const;

function toISODate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

interface ExpenseRow {
  id: string; version: number; organizationId: string; hostelId: string | null; category: string;
  status: LedgerEntryStatus; amount: number; spentAt: Date; paymentMethod: PaymentMethod | null;
  description: string | null; actorUserId: string | null; reversedById: string | null; createdAt: Date; updatedAt: Date;
}

function toExpenseDto(row: ExpenseRow) {
  return {
    id: row.id, version: row.version, organizationId: row.organizationId,
    hostelId: row.hostelId ?? undefined, category: row.category, status: row.status,
    money: { amount: row.amount, currency: 'AFN' },
    spentAt: toISODate(row.spentAt),
    paymentMethod: row.paymentMethod ?? undefined,
    description: row.description ?? undefined,
    actorUserId: row.actorUserId ?? undefined,
    reversedBy: row.reversedById ?? undefined,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly posting: PostingService,
    private readonly locks: LockService,
  ) {}

  private async emitSync(tx: Prisma.TransactionClient, organizationId: string, entityType: string, entityId: string, entityVersion: number): Promise<void> {
    await this.posting.syncChange(tx, { organizationId, entityType, entityId, action: SyncAction.UPSERT, entityVersion });
  }

  async list(organizationId: string, page: number, size: number) {
    const where: Prisma.ExpenseWhereInput = { organizationId };
    const skip = (page - 1) * size;
    const [rows, totalElements] = await this.prisma.$transaction([
      this.prisma.expense.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size, select: EXPENSE_SELECT }),
      this.prisma.expense.count({ where }),
    ]);
    return {
      items: (rows as unknown as ExpenseRow[]).map(toExpenseDto),
      page, size, totalElements, totalPages: Math.ceil(totalElements / size),
    };
  }

  async get(organizationId: string, expenseId: string) {
    const row = await this.prisma.expense.findFirst({ where: { id: expenseId, organizationId }, select: EXPENSE_SELECT });
    if (!row) throw AppError.notFound('Expense not found');
    return toExpenseDto(row as unknown as ExpenseRow);
  }

  async create(organizationId: string, userId: string, dto: ExpenseCreateDto, idempotencyKey: string, traceId: string) {
    const amount = dto.money.amount;
    if (dto.paymentMethod === PaymentMethod.DEPOSIT_APPLICATION) {
      throw AppError.validation('DEPOSIT_APPLICATION is not a valid expense payment method', [
        { field: 'paymentMethod', code: 'invalid', message: 'DEPOSIT_APPLICATION cannot pay an expense' },
      ]);
    }
    const endpoint = '/api/v1/expenses';
    const requestHash = canonicalRequestHash({ method: 'POST', route: endpoint, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toExpenseDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        if (dto.hostelId) {
          const hostel = await tx.hostel.findFirst({ where: { id: dto.hostelId, organizationId }, select: { id: true } });
          if (!hostel) throw AppError.notFound('Hostel not found');
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const row = (await tx.expense.create({
          data: {
            organizationId, hostelId: dto.hostelId ?? null, category: dto.category, amount,
            spentAt: toDateOnly(dto.spentAt), paymentMethod: dto.paymentMethod ?? null,
            description: dto.description ?? null, actorUserId: userId,
          },
          select: EXPENSE_SELECT,
        })) as unknown as ExpenseRow;

        await this.posting.audit(tx, {
          organizationId, actorUserId: userId, action: 'EXPENSE_CREATED', entityType: 'EXPENSE', entityId: row.id, traceId,
          after: { businessDate, category: row.category, amount, paymentMethod: row.paymentMethod, hostelId: row.hostelId } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'EXPENSE', row.id, row.version);
        return toExpenseDto(row);
      },
      {
        toRecord: (result) => ({ resourceType: 'EXPENSE', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId) throw AppError.internal('Idempotency record is missing its expense reference');
          const row = await this.prisma.expense.findFirst({ where: { id: ref.resourceId, organizationId }, select: EXPENSE_SELECT });
          if (!row) throw AppError.internal('Expense referenced by idempotency record no longer exists');
          return toExpenseDto(row as unknown as ExpenseRow);
        },
      },
    );
  }

  async reverse(organizationId: string, userId: string, expenseId: string, dto: ReversalDto, idempotencyKey: string, traceId: string) {
    const endpoint = `/api/v1/expenses/${expenseId}/reverse`;
    const requestHash = canonicalRequestHash({ method: 'POST', route: '/api/v1/expenses/{expenseId}/reverse', pathParams: { expenseId }, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toExpenseDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 200, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        await this.locks.lockExpense(tx, expenseId, organizationId);
        const expense = await tx.expense.findFirst({
          where: { id: expenseId, organizationId },
          select: { id: true, version: true, status: true, amount: true },
        });
        if (!expense) throw AppError.notFound('Expense not found');
        if (expense.status === LedgerEntryStatus.REVERSED) throw AppError.conflict('Expense is already reversed', ErrorCode.EXPENSE_ALREADY_REVERSED);

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const updated = (await tx.expense.update({
          where: { id: expense.id },
          data: { status: LedgerEntryStatus.REVERSED, reversedById: userId, reversalReason: dto.reason, reversedAt: new Date(), version: { increment: 1 } },
          select: EXPENSE_SELECT,
        })) as unknown as ExpenseRow;

        const reversal = await tx.ledgerReversal.create({
          data: {
            organizationId, residentId: null, sourceType: ReversalSourceType.EXPENSE, sourceId: expense.id,
            side: EntrySide.CREDIT, amount: expense.amount, reason: dto.reason, actorUserId: userId, idempotencyKey,
          },
          select: { id: true },
        });

        await this.posting.audit(tx, {
          organizationId, actorUserId: userId, action: 'EXPENSE_REVERSED', entityType: 'EXPENSE', entityId: expense.id, traceId,
          after: { businessDate, reversalId: reversal.id, reason: dto.reason } as unknown as Prisma.InputJsonValue,
        });
        await this.emitSync(tx, organizationId, 'EXPENSE', expense.id, updated.version);
        await this.emitSync(tx, organizationId, 'LEDGER_REVERSAL', reversal.id, 1);
        return toExpenseDto(updated);
      },
      {
        toRecord: (result) => ({ resourceType: 'EXPENSE', resourceId: result.id }),
        fromRecord: async (record) => {
          const ref = record as { resourceId?: string };
          if (!ref.resourceId) throw AppError.internal('Idempotency record is missing its expense reference');
          const row = await this.prisma.expense.findFirst({ where: { id: ref.resourceId, organizationId }, select: EXPENSE_SELECT });
          if (!row) throw AppError.internal('Expense referenced by idempotency record no longer exists');
          return toExpenseDto(row as unknown as ExpenseRow);
        },
      },
    );
  }
}