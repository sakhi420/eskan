import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { SyncAction } from '../../generated/prisma/enums';

export interface AuditRecordInput {
  organizationId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  traceId: string;
  /** Serialized summary (businessDate + domain fields); PII/tokens are never stored. */
  after?: Prisma.InputJsonValue;
}

export interface SyncRecordInput {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: SyncAction;
  entityVersion: number;
}

/**
 * Write-side audit + sync event recorder for financial postings.
 *
 * Both must run inside the SAME transaction as the domain mutation so that a
 * posting, its idempotency claim, its audit event and its sync change commit or
 * roll back together (Phase 9 execution directive section 5). No read/pull API
 * is built here (M3d).
 */
@Injectable()
export class PostingService {
  async audit(tx: Prisma.TransactionClient, input: AuditRecordInput): Promise<void> {
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        traceId: input.traceId,
        after: input.after,
      },
    });
  }

  async syncChange(tx: Prisma.TransactionClient, input: SyncRecordInput): Promise<void> {
    const sequence = await this.nextSequence(tx, input.organizationId);
    await tx.syncChange.create({
      data: {
        organizationId: input.organizationId,
        sequence,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        entityVersion: input.entityVersion,
      },
    });
  }

  /**
   * Atomically reserves the next org-scoped, commit-ordered sequence from
   * `organization_sync_state` (upsert + RETURNING). Called inside the posting
   * transaction so concurrent postings never reuse or skip the same sequence.
   */
  private async nextSequence(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ current_cursor: number }>>`
      INSERT INTO "organization_sync_state" ("organization_id", "current_cursor", "schema_version", "updated_at")
      VALUES (${organizationId}, 1, 1, now())
      ON CONFLICT ("organization_id")
      DO UPDATE SET "current_cursor" = "organization_sync_state"."current_cursor" + 1, "updated_at" = now()
      RETURNING "current_cursor"
    `;
    return Number(rows[0].current_cursor);
  }
}
