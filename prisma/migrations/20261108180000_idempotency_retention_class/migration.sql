-- Idempotency retention class (Offline-first, Phase 9 decision 4c).
-- Queueable lifecycle mutations require PERMANENT retention (expires_at = NULL,
-- never lazy-deleted) so a retry many days later replays the same stored result.
-- TRANSIENT keeps the previous 30-day lazy-expiry behaviour.

-- CreateEnum
CREATE TYPE "IdempotencyRetentionClass" AS ENUM ('TRANSIENT', 'PERMANENT');

-- AlterTable
ALTER TABLE "idempotency_records"
  ADD COLUMN "retention_class" "IdempotencyRetentionClass" NOT NULL DEFAULT 'TRANSIENT';

ALTER TABLE "idempotency_records"
  ALTER COLUMN "expires_at" DROP NOT NULL;