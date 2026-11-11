import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

/**
 * Row-level advisory locking helper.
 *
 * The underlying tables are keyed by UUID primary keys, so the id arguments are
 * always UUID strings and are bound as query parameters (never interpolated),
 * which keeps the queries injection-safe.
 *
 * Org-scoped locks are tenant-isolated: `lockForUpdate` takes a mandatory
 * `organizationId` and always filters `WHERE id = $1 AND organization_id = $2`,
 * so a tenant can neither lock nor block another tenant's row. Global entities
 * (Organization, User, RefreshSession) use `lockGlobal`, never an org filter.
 *
 * The locks here MUST be taken in a fixed global order to avoid deadlocks.
 * Two orders coexist:
 *
 *   Living-hall hierarchy (master data writes):
 *     Hostel -> Room -> Bed -> Resident -> Contract
 *
 *   Canonical financial order (Phase 9, all financial writes):
 *     Organization -> Resident(s sorted by id) -> Contract(s sorted by id)
 *     -> Charge(s sorted by id) -> Payment -> ...
 *     (tenant-scoped records such as TemporaryAbsence are locked after their
 *      owning Resident/Contract, in id order)
 *
 * The Organization lock (a global row) is taken first whenever both it and an
 * org-scoped entity are needed, so it acts as the single serialization point
 * for org-level financial invariants and prevents cross-entity deadlocks.
 *
 * `SELECT ... FOR UPDATE` acquires the row lock immediately and, if the row
 * does not exist, returns no row (and therefore holds no lock) which the
 * caller detects via the subsequent existence check in the same transaction.
 */
type OrgEntity = 'hostel' | 'room' | 'bed' | 'resident' | 'contract' | 'temporary_absence' | 'charge' | 'payment' | 'allocation';
type GlobalEntity = 'organization' | 'user' | 'refresh_session';

const ORG_TABLE_SQL: Record<OrgEntity, string> = {
  hostel: '"hostels"',
  room: '"rooms"',
  bed: '"beds"',
  resident: '"residents"',
  contract: '"stay_contracts"',
  temporary_absence: '"temporary_absences"',
  charge: '"charges"',
  payment: '"payments"',
  allocation: '"payment_allocations"',
};

const GLOBAL_TABLE_SQL: Record<GlobalEntity, string> = {
  organization: '"organizations"',
  user: '"users"',
  refresh_session: '"refresh_sessions"',
};

@Injectable()
export class LockService {
  /**
   * Exclusive row lock for an org-scoped entity, tenant-isolated by
   * `organization_id`. The `organizationId` argument is mandatory.
   */
  async lockForUpdate(tx: Prisma.TransactionClient, entity: OrgEntity, id: string, organizationId: string): Promise<void> {
    if (!organizationId) {
      throw new Error(`LockService.lockForUpdate: organizationId is required for org-scoped entity "${entity}"`);
    }
    await tx.$queryRawUnsafe(
      `SELECT id FROM ${ORG_TABLE_SQL[entity]} WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      id,
      organizationId,
    );
  }

  /**
   * Exclusive row lock for a global (non-org-scoped) entity. Only Organization,
   * User and RefreshSession may be locked this way; never add `organization_id`.
   */
  async lockGlobal(tx: Prisma.TransactionClient, entity: GlobalEntity, id: string): Promise<void> {
    await tx.$queryRawUnsafe(`SELECT id FROM ${GLOBAL_TABLE_SQL[entity]} WHERE id = $1 FOR UPDATE`, id);
  }

  async lockHostel(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'hostel', id, organizationId);
  }

  async lockRoom(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'room', id, organizationId);
  }

  async lockBed(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'bed', id, organizationId);
  }

  async lockResident(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'resident', id, organizationId);
  }

  async lockContract(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'contract', id, organizationId);
  }

  async lockTemporaryAbsence(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'temporary_absence', id, organizationId);
  }

  /** Financial-workflow lock for a Charge row (canonical financial order, tenant-scoped). */
  async lockCharge(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'charge', id, organizationId);
  }

  /** Financial-workflow lock for a Payment row (canonical financial order, tenant-scoped). */
  async lockPayment(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'payment', id, organizationId);
  }

  /** Financial-workflow lock for a PaymentAllocation row (canonical financial order, tenant-scoped). */
  async lockAllocation(tx: Prisma.TransactionClient, id: string, organizationId: string): Promise<void> {
    await this.lockForUpdate(tx, 'allocation', id, organizationId);
  }

  /**
   * Org-scoped serialization lock for org-level invariants (all financial
   * postings, the "never demote/deactivate the last active owner" rule, ...).
   *
   * Implemented as a transaction-scoped PostgreSQL advisory lock keyed on the
   * organization id. This deliberately does NOT take a physical `FOR UPDATE`
   * row lock on the organization: an idempotency-record FK insert already
   * acquires a `FOR KEY SHARE` lock on the same row, and two concurrent
   * financial postings would otherwise deadlock upgrading that to `FOR UPDATE`.
   * Advisory locks only conflict with the same advisory lock, so they serialize
   * org-level writers without colliding with FK row locks (Phase 9 canonical
   * order: Organization first).
   */
  async lockOrganization(tx: Prisma.TransactionClient, id: string): Promise<void> {
    // The subquery makes the statement return a deserializable `int` (the
    // advisory-lock function itself returns `void`, which Prisma's raw client
    // cannot deserialize).
    await tx.$queryRawUnsafe(
      `SELECT count(*)::int FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) AS t`,
      id,
    );
  }
}