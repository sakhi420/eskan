-- M-1: BedAssignment.endReason (nullable) + amount domain CHECK constraints.
--
-- (1) endReason records WHY an assignment ended. New service code always sets
--     it (CHECKOUT / TRANSFER / MANUAL_END); legacy rows stay NULL and are
--     treated as LEGACY_UNKNOWN per decision D-04. History is never rewritten.
--
-- (2) Amount domain rules enforce the OpenAPI "Money positive / deposit may be
--     zero" contract at the database level. Postgres `integer` columns are
--     already 32-bit, so the int32 upper bound (2,147,483,647) is inherent.
--
-- Transactionality: the whole migration runs in an explicit BEGIN/COMMIT and the
-- preflight executes BEFORE any DDL. PostgreSQL supports transactional DDL, so
-- any statement that fails rolls back everything (no partial enum/column is left
-- behind on a preflight failure).

BEGIN;

-- Preflight FIRST (before any DDL). Surface actionable per-table counts so an
-- operator sees which table has invalid rows (query IDs individually when a
-- count is non-zero). No amount is auto-corrected.
DO $$
DECLARE
  bad_contracts  integer;
  bad_deposits   integer;
  bad_charges    integer;
  bad_payments   integer;
  bad_allocs     integer;
  bad_dep_tx     integer;
  bad_expenses   integer;
  bad_manual     integer;
BEGIN
  SELECT count(*) INTO bad_contracts FROM "stay_contracts"            WHERE "rent_amount" <= 0;
  SELECT count(*) INTO bad_deposits  FROM "stay_contracts"            WHERE "deposit_amount" < 0;
  SELECT count(*) INTO bad_charges   FROM "charges"                   WHERE "amount" <= 0;
  SELECT count(*) INTO bad_payments  FROM "payments"                  WHERE "amount" <= 0;
  SELECT count(*) INTO bad_allocs    FROM "payment_allocations"       WHERE "amount" <= 0;
  SELECT count(*) INTO bad_dep_tx    FROM "deposit_transactions"      WHERE "amount" <= 0;
  SELECT count(*) INTO bad_expenses  FROM "expenses"                  WHERE "amount" <= 0;
  SELECT count(*) INTO bad_manual    FROM "manual_subscription_payments" WHERE "amount" <= 0;

  IF bad_contracts + bad_deposits + bad_charges + bad_payments + bad_allocs
     + bad_dep_tx + bad_expenses + bad_manual > 0 THEN
    RAISE EXCEPTION
      'amount preflight failed: contracts=% deposits=% charges=% payments=% allocations=% deposit_transactions=% expenses=% manual_payments=%',
      bad_contracts, bad_deposits, bad_charges, bad_payments, bad_allocs,
      bad_dep_tx, bad_expenses, bad_manual;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "AssignmentEndReason" AS ENUM ('CHECKOUT', 'TRANSFER', 'TERMINATE', 'MANUAL_END');

-- AlterTable
ALTER TABLE "bed_assignments"
  ADD COLUMN "end_reason" "AssignmentEndReason";

-- Money lower-bound domain rules. rent must be positive; deposit may be zero.
ALTER TABLE "stay_contracts"
  ADD CONSTRAINT "stay_contracts_rent_positive"
  CHECK ("rent_amount" > 0);

ALTER TABLE "stay_contracts"
  ADD CONSTRAINT "stay_contracts_deposit_nonnegative"
  CHECK ("deposit_amount" IS NULL OR "deposit_amount" >= 0);

ALTER TABLE "charges"
  ADD CONSTRAINT "charges_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "deposit_transactions"
  ADD CONSTRAINT "deposit_transactions_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "manual_subscription_payments"
  ADD CONSTRAINT "manual_subscription_payments_amount_positive"
  CHECK ("amount" > 0);

COMMIT;