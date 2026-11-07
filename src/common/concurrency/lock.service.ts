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
 * The locks here MUST be taken in a fixed global order to avoid deadlocks. The
 * order used across every write path is a depth-first walk of the living-hall
 * hierarchy:
 *
 *   Hostel -> Room -> Bed -> Resident -> Contract
 *
 * `SELECT ... FOR UPDATE` acquires the row lock immediately and, if the row
 * does not exist, returns no row (and therefore holds no lock) which the
 * caller detects via the subsequent existence check in the same transaction.
 */
type OrgEntity = 'hostel' | 'room' | 'bed' | 'resident' | 'contract';
type GlobalEntity = 'organization' | 'user' | 'refresh_session';

const ORG_TABLE_SQL: Record<OrgEntity, string> = {
  hostel: '"hostels"',
  room: '"rooms"',
  bed: '"beds"',
  resident: '"residents"',
  contract: '"stay_contracts"',
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

  /**
   * Row lock on the owning organisation (a global entity), used for org-level
   * invariants such as the "never demote/deactivate the last active owner" rule.
   * It is orthogonal to the living-hall chain (Hostel -> Room -> Bed -> Resident
   * -> Contract), so take it first when both are needed in the same transaction.
   */
  async lockOrganization(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await this.lockGlobal(tx, 'organization', id);
  }
}