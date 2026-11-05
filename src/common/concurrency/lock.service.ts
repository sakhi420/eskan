import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

/**
 * Row-level advisory locking helper.
 *
 * The underlying tables are keyed by UUID primary keys, so the id arguments are
 * always UUID strings and are bound as query parameters (never interpolated),
 * which keeps the queries injection-safe.
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
type LockableEntity = 'hostel' | 'room' | 'bed' | 'resident' | 'contract' | 'organization';

const TABLE_SQL: Record<LockableEntity, string> = {
  hostel: '"hostels"',
  room: '"rooms"',
  bed: '"beds"',
  resident: '"residents"',
  contract: '"stay_contracts"',
  organization: '"organizations"',
};

@Injectable()
export class LockService {
  /** Exclusive row lock for the duration of the surrounding transaction. */
  async lockForUpdate(tx: Prisma.TransactionClient, entity: LockableEntity, id: string): Promise<void> {
    await tx.$queryRawUnsafe(`SELECT id FROM ${TABLE_SQL[entity]} WHERE id = $1 FOR UPDATE`, id);
  }

  async lockHostel(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await this.lockForUpdate(tx, 'hostel', id);
  }

  async lockRoom(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await this.lockForUpdate(tx, 'room', id);
  }

  async lockBed(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await this.lockForUpdate(tx, 'bed', id);
  }

  async lockResident(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await this.lockForUpdate(tx, 'resident', id);
  }

  async lockContract(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await this.lockForUpdate(tx, 'contract', id);
  }

  /**
   * Row lock on the owning organisation, used for org-level invariants such as
   * the "never demote/deactivate the last active owner" rule. It is orthogonal
   * to the living-hall chain (Hostel -> Room -> Bed -> Resident -> Contract),
   * so take it first when both are needed in the same transaction.
   */
  async lockOrganization(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await this.lockForUpdate(tx, 'organization', id);
  }
}