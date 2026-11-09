import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AbsenceStatus, ChargeType, ContractStatus, EntrySide, LedgerEntryStatus, ResidentStatus, SyncAction } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { PostingService } from '../common/finance/posting.service';
import { LockService } from '../common/concurrency/lock.service';
import { businessTodayForOrg } from '../common/date/business-date';
import { canonicalRequestHash } from '../common/idempotency/jcs';
import { isUniqueViolation } from '../common/prisma/unique-violation';
import { ChargeDto } from './dto/charge.dto';
import { BillingPreviewRequestDto, BillingPostRequestDto } from './dto/billing.dto';
import {
  daysBetweenExclusive, daysInMonth, isCanonicalBillingMonth, parseDateOnly,
  prorateComponents, splitIntoMonths, toISO, type ProratableComponent,
} from './proration';

const CHARGE_SELECT = {
  id: true, version: true, organizationId: true, residentId: true, contractId: true,
  type: true, entrySide: true, status: true, amount: true, periodStart: true, periodEnd: true,
  dueDate: true, description: true, postedAt: true, createdAt: true, updatedAt: true,
} as const;

function toISODate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

interface ChargeRow {
  id: string; version: number; organizationId: string; residentId: string; contractId: string | null;
  type: ChargeType; entrySide: EntrySide; status: LedgerEntryStatus; amount: number;
  periodStart: Date; periodEnd: Date; dueDate: Date; description: string | null;
  postedAt: Date; createdAt: Date; updatedAt: Date;
}

function toChargeDto(row: ChargeRow) {
  return {
    id: row.id, version: row.version, organizationId: row.organizationId, residentId: row.residentId,
    contractId: row.contractId, type: row.type, entrySide: row.entrySide, status: row.status,
    money: { amount: row.amount, currency: 'AFN' },
    periodStart: toISODate(row.periodStart), periodEnd: toISODate(row.periodEnd),
    dueDate: toISODate(row.dueDate), description: row.description,
    reversedBy: null, postedAt: row.postedAt.toISOString(),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function componentsFromSnapshot(snapshot: Prisma.JsonValue | null): ProratableComponent[] {
  if (!snapshot || !Array.isArray(snapshot)) return [];
  return (snapshot as unknown as ProratableComponent[]).map((c) => ({
    kind: c.kind, name: c.name, amount: c.amount, deductibleOnAbsence: !!c.deductibleOnAbsence,
  }));
}

@Injectable()
export class ChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly posting: PostingService,
    private readonly locks: LockService,
  ) {}

  private async reportPosting(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string; actorUserId: string; traceId: string; businessDate: string;
      entityType: string; entityId: string; entityVersion: number; action: string; after: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await this.posting.audit(tx, {
      organizationId: input.organizationId, actorUserId: input.actorUserId, action: input.action,
      entityType: input.entityType, entityId: input.entityId, traceId: input.traceId, after: input.after,
    });
    await this.posting.syncChange(tx, {
      organizationId: input.organizationId, entityType: input.entityType, entityId: input.entityId,
      action: SyncAction.UPSERT, entityVersion: input.entityVersion,
    });
  }

  async createCharge(
    organizationId: string,
    userId: string,
    dto: ChargeDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    if (dto.periodEnd <= dto.periodStart) {
      throw AppError.validation('periodEnd must be after periodStart', [
        { field: 'periodEnd', code: 'invalid', message: 'must be after periodStart' },
      ]);
    }
    if (dto.type === ChargeType.RENT && !dto.contractId) {
      throw AppError.validation('RENT charge requires a contractId', [
        { field: 'contractId', code: 'required', message: 'RENT requires a contractId' },
      ]);
    }
    const entrySide = dto.entrySide ?? EntrySide.DEBIT;

    // RENT business key is (organization, contract, billing month) so that the
    // manual /charges path and the billing Post path converge on one canonical
    // period and can never both create a RENT debt for the same month (F-23).
    if (dto.type === ChargeType.RENT) {
      if (!isCanonicalBillingMonth(parseDateOnly(dto.periodStart), parseDateOnly(dto.periodEnd))) {
        throw AppError.validation('RENT period must be a single calendar month [first-of-month, first-of-next-month)', [
          { field: 'periodEnd', code: 'invalid', message: 'RENT period must span exactly one calendar month' },
        ]);
      }
    }

    // Manual credits require a non-empty reason and must be classified as an
    // ADJUSTMENT (never RENT), so they never occupy the RENT business key
    // (D-07).
    if (entrySide === EntrySide.CREDIT) {
      if (!dto.description || dto.description.trim().length === 0) {
        throw AppError.validation('A reason (description) is required for credits', [
          { field: 'description', code: 'required', message: 'description is required for CREDIT' },
        ]);
      }
      if (dto.type === ChargeType.RENT) {
        throw AppError.validation('Manual CREDIT must use type ADJUSTMENT, not RENT', [
          { field: 'type', code: 'invalid', message: 'CREDIT must be classified as ADJUSTMENT' },
        ]);
      }
    }

    const endpoint = '/api/v1/charges';
    const requestHash = canonicalRequestHash({ method: 'POST', route: endpoint, body: dto });

    return this.idempotency.runAtomic<ReturnType<typeof toChargeDto>>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);
        await this.locks.lockResident(tx, dto.residentId, organizationId);
        const resident = await tx.resident.findFirst({
          where: { id: dto.residentId, organizationId }, select: { id: true, status: true },
        });
        if (!resident) throw AppError.notFound('Resident not found');
        if (resident.status !== ResidentStatus.ACTIVE) {
          throw AppError.conflict('Resident is not active', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        if (dto.type === ChargeType.RENT) {
          await this.locks.lockContract(tx, dto.contractId!, organizationId);
          const contract = await tx.stayContract.findFirst({
            where: { id: dto.contractId!, organizationId, residentId: dto.residentId },
            select: { id: true, status: true },
          });
          if (!contract) throw AppError.notFound('Contract not found for this resident');
          if (contract.status !== ContractStatus.ACTIVE) {
            throw AppError.conflict('RENT can only be charged on an ACTIVE contract', ErrorCode.BUSINESS_RULE_VIOLATION);
          }
          const dup = await tx.charge.findFirst({
            where: {
              organizationId, contractId: dto.contractId, type: ChargeType.RENT,
              periodStart: parseDateOnly(dto.periodStart), periodEnd: parseDateOnly(dto.periodEnd),
            },
            select: { id: true },
          });
          if (dup) {
            throw AppError.conflict('Rent charge already exists for this contract and period', ErrorCode.BUSINESS_RULE_VIOLATION);
          }
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);
        let charge: ChargeRow;
        try {
          charge = (await tx.charge.create({
            data: {
              organizationId, residentId: dto.residentId, contractId: dto.contractId ?? null,
              type: dto.type, entrySide, amount: dto.money.amount,
              periodStart: parseDateOnly(dto.periodStart), periodEnd: parseDateOnly(dto.periodEnd),
              dueDate: parseDateOnly(dto.dueDate), description: dto.description ?? null,
            },
            select: CHARGE_SELECT,
          })) as unknown as ChargeRow;
        } catch (err) {
          // DB-level rent business-key race (partial unique index). Idempotency claim
          // already happened before mutate, so P2002 here is a domain duplicate.
          if (isUniqueViolation(err)) {
            throw AppError.conflict('Rent charge already exists for this contract and period', ErrorCode.BUSINESS_RULE_VIOLATION);
          }
          throw err;
        }

        await this.reportPosting(tx, {
          organizationId, actorUserId: userId, traceId, businessDate,
          entityType: 'CHARGE', entityId: charge.id, entityVersion: charge.version,
          action: entrySide === EntrySide.CREDIT ? 'CREDIT_POSTED' : 'CHARGE_CREATED',
          after: {
            businessDate, type: charge.type, entrySide: charge.entrySide, amount: charge.amount,
            periodStart: toISODate(charge.periodStart), periodEnd: toISODate(charge.periodEnd),
            dueDate: toISODate(charge.dueDate), reason: dto.description ?? null,
          } as unknown as Prisma.InputJsonValue,
        });

        return toChargeDto(charge);
      },
    );
  }

  async getCharge(organizationId: string, chargeId: string) {
    const charge = await this.prisma.charge.findFirst({
      where: { id: chargeId, organizationId }, select: CHARGE_SELECT,
    }) as unknown as ChargeRow | null;
    if (!charge) throw AppError.notFound('Charge not found');
    return toChargeDto(charge);
  }

  async listCharges(organizationId: string, page: number, size: number, residentId?: string, type?: ChargeType) {
    const where: Prisma.ChargeWhereInput = { organizationId, ...(residentId ? { residentId } : {}), ...(type ? { type } : {}) };
    const skip = (page - 1) * size;
    const [rows, totalElements] = await this.prisma.$transaction([
      this.prisma.charge.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size, select: CHARGE_SELECT }),
      this.prisma.charge.count({ where }),
    ]);
    return {
      items: (rows as unknown as ChargeRow[]).map(toChargeDto),
      page, size, totalElements, totalPages: Math.ceil(totalElements / size),
    };
  }

  private contractComponents(rentAmount: number, snapshot: Prisma.JsonValue | null): ProratableComponent[] {
    const comps = componentsFromSnapshot(snapshot);
    if (comps.length > 0) return comps;
    return [{ kind: 'ACCOMMODATION', name: 'Rent', amount: rentAmount, deductibleOnAbsence: false }];
  }

  private async loadBillingContracts(
    tx: Prisma.TransactionClient, organizationId: string, periodStart: Date, periodEnd: Date, residentId?: string,
  ) {
    return tx.stayContract.findMany({
      where: {
        organizationId, status: ContractStatus.ACTIVE, startDate: { lt: periodEnd },
        OR: [{ endDate: null }, { endDate: { gt: periodStart } }],
        ...(residentId ? { residentId } : {}),
      },
      orderBy: { id: 'asc' },
      select: {
        id: true, residentId: true, rentAmount: true, packageSnapshot: true, startDate: true, endDate: true,
        hostel: { select: { rentDueDayOfMonth: true } },
      },
    });
  }

  private buildLines(
    contracts: Array<{ id: string; residentId: string; rentAmount: number; packageSnapshot: Prisma.JsonValue | null; startDate: Date; endDate: Date | null; hostel: { rentDueDayOfMonth: number | null } }>,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const calendarDays = daysInMonth(periodStart);
    const lines: Array<{ residentId: string; contractId: string; dueDayOfMonth: number | null; money: { amount: number; currency: string }; periodStart: string; periodEnd: string; components: Array<{ kind: string; name: string; amount: number }> }> = [];
    for (const c of contracts) {
      const occStart = c.startDate > periodStart ? c.startDate : periodStart;
      const occEnd = c.endDate && c.endDate < periodEnd ? c.endDate : periodEnd;
      const occupiedDays = daysBetweenExclusive(occStart, occEnd);
      if (occupiedDays <= 0) continue;
      const { total, components } = prorateComponents(this.contractComponents(c.rentAmount, c.packageSnapshot), occupiedDays, calendarDays);
      lines.push({
        residentId: c.residentId, contractId: c.id,
        dueDayOfMonth: c.hostel.rentDueDayOfMonth,
        money: { amount: total, currency: 'AFN' },
        // Charge period is the canonical billing month, not the occupancy
        // overlap, so RENT de-duplicates against the manual /charges path via
        // the same (organization, contract, month) business key.
        periodStart: toISO(periodStart), periodEnd: toISO(periodEnd),
        components: components.map((x) => ({ kind: x.kind, name: x.name, amount: x.amount })),
      });
    }
    return { lines, total: lines.reduce((acc, l) => acc + BigInt(l.money.amount), 0n) };
  }

  private clampDueDate(periodStart: Date, dueDay: number): Date {
    const clamped = Math.min(dueDay, daysInMonth(periodStart));
    return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), clamped));
  }

  async previewBilling(organizationId: string, dto: BillingPreviewRequestDto) {
    const periodStart = parseDateOnly(dto.periodStart);
    const periodEnd = parseDateOnly(dto.periodEnd);
    if (!isCanonicalBillingMonth(periodStart, periodEnd)) {
      throw AppError.validation('Billing period must be a single calendar month [first-of-month, first-of-next-month)', [
        { field: 'periodEnd', code: 'invalid', message: 'period must span exactly one calendar month' },
      ]);
    }
    const contracts = await this.prisma.$transaction((tx) => this.loadBillingContracts(tx, organizationId, periodStart, periodEnd, dto.residentId));
    const { lines, total } = this.buildLines(contracts, periodStart, periodEnd);
    return { periodStart: dto.periodStart, periodEnd: dto.periodEnd, lines, totalAmount: total.toString() };
  }

  async postBilling(
    organizationId: string,
    userId: string,
    dto: BillingPostRequestDto,
    idempotencyKey: string,
    traceId: string,
  ) {
    const periodStart = parseDateOnly(dto.periodStart);
    const periodEnd = parseDateOnly(dto.periodEnd);
    if (!isCanonicalBillingMonth(periodStart, periodEnd)) {
      throw AppError.validation('Billing period must be a single calendar month [first-of-month, first-of-next-month)', [
        { field: 'periodEnd', code: 'invalid', message: 'period must span exactly one calendar month' },
      ]);
    }
    const businessKey = `${dto.periodStart}|${dto.periodEnd}`;
    const endpoint = '/api/v1/billing-runs';
    const requestHash = canonicalRequestHash({ method: 'POST', route: endpoint, body: dto });

    return this.idempotency.runAtomic<{
      id: string; organizationId: string; periodStart: string; periodEnd: string; businessKey: string;
      dueDayOfMonth: number | null; status: string; totalAmount: string; createdByUserId: string; createdAt: string;
    }>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 201, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);

        const existing = await tx.billingRun.findFirst({
          where: { organizationId, periodStart, periodEnd }, select: { id: true },
        });
        if (existing) {
          throw AppError.conflict('Billing run already posted for this period', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const snapshot = await this.loadBillingContracts(tx, organizationId, periodStart, periodEnd);
        for (const rid of [...new Set(snapshot.map((c) => c.residentId))].sort()) {
          await this.locks.lockResident(tx, rid, organizationId);
        }
        for (const cid of snapshot.map((c) => c.id).sort()) {
          await this.locks.lockContract(tx, cid, organizationId);
        }

        // Re-read under the held locks so status/period decisions are made on
        // the authoritative rows (canonical Organization -> Resident -> Contract
        // locking order; see lock.service.ts).
        const contracts = await this.loadBillingContracts(tx, organizationId, periodStart, periodEnd);
        const { lines, total } = this.buildLines(contracts, periodStart, periodEnd);

        if (lines.length === 0 || total === 0n) {
          throw AppError.conflict('No chargeable contracts for this billing period', ErrorCode.BUSINESS_RULE_VIOLATION);
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);

        let run: { id: string; createdAt: Date };
        try {
          run = await tx.billingRun.create({
            data: {
              organizationId, periodStart, periodEnd, businessKey,
              dueDayOfMonth: dto.dueDayOfMonth ?? null, status: 'POSTED',
              totalAmount: total, createdByUserId: userId,
            },
            select: { id: true, createdAt: true },
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw AppError.conflict('Billing run already posted for this period', ErrorCode.BUSINESS_RULE_VIOLATION);
          }
          throw err;
        }

        for (const line of lines) {
          if (line.money.amount <= 0) continue;
          // Per-hostel due day (no blanket `contracts[0]` default): the override
          // in the request applies to the whole run, otherwise each contract's
          // own hostel rent_due_day_of_month is used.
          const dueDay = dto.dueDayOfMonth ?? line.dueDayOfMonth ?? 1;
          const dueDate = this.clampDueDate(periodStart, dueDay);
          let charge: ChargeRow;
          try {
            charge = (await tx.charge.create({
              data: {
                organizationId, residentId: line.residentId, contractId: line.contractId,
                type: ChargeType.RENT, entrySide: EntrySide.DEBIT, amount: line.money.amount,
                periodStart: parseDateOnly(line.periodStart), periodEnd: parseDateOnly(line.periodEnd),
                dueDate, description: null,
                components: {
                  create: line.components.map((x, i) => ({
                    kind: x.kind as never, name: x.name, amount: x.amount, deductibleOnAbsence: false, sortOrder: i,
                  })),
                },
              },
              select: CHARGE_SELECT,
            })) as unknown as ChargeRow;
          } catch (err) {
            if (isUniqueViolation(err)) {
              throw AppError.conflict('Rent charge already exists for a contract in this period', ErrorCode.BUSINESS_RULE_VIOLATION);
            }
            throw err;
          }
          await this.reportPosting(tx, {
            organizationId, actorUserId: userId, traceId, businessDate,
            entityType: 'CHARGE', entityId: charge.id, entityVersion: charge.version, action: 'BILLING_CHARGE_POSTED',
            after: { businessDate, billingRunId: run.id, type: 'RENT', entrySide: 'DEBIT', amount: charge.amount } as unknown as Prisma.InputJsonValue,
          });
        }

        await this.reportPosting(tx, {
          organizationId, actorUserId: userId, traceId, businessDate,
          entityType: 'BILLING_RUN', entityId: run.id, entityVersion: 1, action: 'BILLING_RUN_POSTED',
          after: { businessDate, periodStart: dto.periodStart, periodEnd: dto.periodEnd, totalAmount: total.toString(), chargeCount: lines.filter((l) => l.money.amount > 0).length } as unknown as Prisma.InputJsonValue,
        });

        return {
          id: run.id, organizationId, periodStart: dto.periodStart, periodEnd: dto.periodEnd, businessKey,
          dueDayOfMonth: dto.dueDayOfMonth ?? null, status: 'POSTED', totalAmount: String(total),
          createdByUserId: userId, createdAt: run.createdAt.toISOString(),
        };
      },
    );
  }

  private async existingCredits(tx: Prisma.TransactionClient, organizationId: string, absenceId: string) {
    const rows = await tx.absenceCredit.findMany({
      where: { organizationId, absenceId }, orderBy: { periodStart: 'asc' },
    });
    return {
      credits: rows.map((r) => ({
        id: r.id, organizationId: r.organizationId, residentId: r.residentId, absenceId: r.absenceId,
        chargeId: r.chargeId, periodStart: toISODate(r.periodStart), periodEnd: toISODate(r.periodEnd),
        money: { amount: r.amount, currency: 'AFN' }, createdAt: r.createdAt.toISOString(),
      })),
      totalCredit: rows.reduce((acc, r) => acc + BigInt(r.amount), 0n).toString(),
    };
  }

  async generateAbsenceCredits(
    organizationId: string,
    userId: string,
    absenceId: string,
    idempotencyKey: string,
    traceId: string,
  ) {
    const endpoint = `/api/v1/absences/${absenceId}/credits`;
    const requestHash = canonicalRequestHash({
      method: 'POST', route: '/api/v1/absences/{absenceId}/credits', pathParams: { absenceId },
    });

    type CreditLine = {
      id: string; organizationId: string; residentId: string; absenceId: string; chargeId: string;
      periodStart: string; periodEnd: string; money: { amount: number; currency: string }; createdAt: string;
    };

    return this.idempotency.runAtomic<{ credits: CreditLine[]; totalCredit: string }>(
      { organizationId, key: idempotencyKey, endpoint, userId, requestHash, statusCode: 200, retentionClass: 'PERMANENT' },
      async (tx) => {
        await this.locks.lockOrganization(tx, organizationId);

        const pre = await tx.temporaryAbsence.findFirst({
          where: { id: absenceId, organizationId },
          select: { id: true, residentId: true, contractId: true },
        });
        if (!pre) throw AppError.notFound('Absence not found');

        // Canonical financial lock order, then re-read under the held locks.
        await this.locks.lockResident(tx, pre.residentId, organizationId);
        await this.locks.lockContract(tx, pre.contractId, organizationId);
        await this.locks.lockTemporaryAbsence(tx, pre.id, organizationId);

        const absence = await tx.temporaryAbsence.findFirst({
          where: { id: absenceId, organizationId },
          select: {
            id: true, residentId: true, contractId: true, status: true,
            actualDepartureDate: true, actualReturnDate: true, approvedAt: true,
            contract: { select: { packageSnapshot: true, hostel: { select: { absenceMinDays: true } } } },
          },
        });
        if (!absence) throw AppError.notFound('Absence not found');

        // CLOSED => idempotent re-read of already-generated credits (no new
        // credits are ever produced). Only RETURNED absences may generate.
        if (absence.status === AbsenceStatus.CLOSED) {
          return this.existingCredits(tx, organizationId, absenceId);
        }

        if (absence.status !== AbsenceStatus.RETURNED) {
          throw AppError.conflict(
            'Absence must be in RETURNED status before credits can be generated',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        if (!absence.actualDepartureDate || !absence.actualReturnDate || !absence.approvedAt) {
          throw AppError.conflict(
            'Absence must have an approved actual return before credits can be generated',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }

        const minDays = absence.contract.hostel.absenceMinDays;
        const totalNights = daysBetweenExclusive(absence.actualDepartureDate, absence.actualReturnDate);
        const hasCreditable = totalNights >= minDays && totalNights > 0;

        if (!hasCreditable) {
          await tx.temporaryAbsence.update({ where: { id: absenceId }, data: { status: 'CLOSED', version: { increment: 1 } } });
          return { credits: [] as CreditLine[], totalCredit: '0' };
        }

        const deductible = componentsFromSnapshot(absence.contract.packageSnapshot).filter(
          (c) => c.deductibleOnAbsence && c.kind !== 'ACCOMMODATION',
        );
        if (deductible.length === 0) {
          await tx.temporaryAbsence.update({ where: { id: absenceId }, data: { status: 'CLOSED', version: { increment: 1 } } });
          return { credits: [] as CreditLine[], totalCredit: '0' };
        }

        const businessDate = await businessTodayForOrg(tx, organizationId);
        const months = splitIntoMonths(absence.actualDepartureDate, absence.actualReturnDate);
        const credits: CreditLine[] = [];
        let totalCredit = 0n;

        for (const m of months) {
          const occupiedDays = daysBetweenExclusive(m.periodStart, m.periodEnd);
          const calendarDays = daysInMonth(m.periodStart);
          const { total, components } = prorateComponents(deductible, occupiedDays, calendarDays);
          if (total <= 0) continue;

          const charge = await tx.charge.create({
            data: {
              organizationId, residentId: absence.residentId, contractId: absence.contractId,
              type: ChargeType.ADJUSTMENT, entrySide: EntrySide.CREDIT, amount: total,
              periodStart: m.periodStart, periodEnd: m.periodEnd, dueDate: m.periodStart,
              description: 'Absence credit',
              components: {
                create: components.map((x, i) => ({
                  kind: x.kind as never, name: x.name, amount: x.amount, deductibleOnAbsence: x.deductibleOnAbsence, sortOrder: i,
                })),
              },
            },
            select: { id: true },
          });

          const credit = await tx.absenceCredit.create({
            data: {
              organizationId, residentId: absence.residentId, absenceId, chargeId: charge.id,
              periodStart: m.periodStart, periodEnd: m.periodEnd, amount: total,
            },
            select: { id: true, createdAt: true },
          });

          await this.reportPosting(tx, {
            organizationId, actorUserId: userId, traceId, businessDate,
            entityType: 'ABSENCE_CREDIT', entityId: credit.id, entityVersion: 1, action: 'ABSENCE_CREDIT_POSTED',
            after: {
              businessDate, absenceId, chargeId: charge.id, amount: total,
              periodStart: toISO(m.periodStart), periodEnd: toISO(m.periodEnd),
            } as unknown as Prisma.InputJsonValue,
          });

          totalCredit += BigInt(total);
          credits.push({
            id: credit.id, organizationId, residentId: absence.residentId, absenceId, chargeId: charge.id,
            periodStart: toISO(m.periodStart), periodEnd: toISO(m.periodEnd),
            money: { amount: total, currency: 'AFN' }, createdAt: credit.createdAt.toISOString(),
          });
        }

        await tx.temporaryAbsence.update({ where: { id: absenceId }, data: { status: 'CLOSED', version: { increment: 1 } } });

        return { credits, totalCredit: String(totalCredit) };
      },
    );
  }
}