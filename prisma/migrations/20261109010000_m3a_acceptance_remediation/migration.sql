-- M3a acceptance remediation (additive, non-destructive).
--
-- (1) Absence status parity with OpenAPI: `RETURNED` represents an absence
--     whose actual return has been recorded but whose credits have not yet
--     been generated (finalized via POST /absences/{id}/credits -> CLOSED).
-- (2) BillingRun.totalAmount widened from INTEGER (int32) to BIGINT (int64)
--     so a full-organization monthly run cannot overflow the per-document
--     int32 money ceiling. Per-charge `amount` remains Int (int32).

-- AlterEnum
ALTER TYPE "AbsenceStatus" ADD VALUE IF NOT EXISTS 'RETURNED';

-- AlterTable
ALTER TABLE "billing_runs" ALTER COLUMN "total_amount" SET DATA TYPE BIGINT;