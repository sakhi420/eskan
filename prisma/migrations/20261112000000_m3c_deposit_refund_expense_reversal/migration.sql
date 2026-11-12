-- PRE-M3c DATA PREFLIGHT — before any M3c DDL.
-- The legacy schema has REFUNDED/FORFEITED events but no structural source link.
-- Never guess their source from Audit JSON: stop before changing the schema and
-- require an explicit, reviewed reconciliation/mapping plan first.
DO $m3c_legacy_preflight$
DECLARE
  legacy_children BIGINT;
BEGIN
  SELECT COUNT(*) INTO legacy_children
    FROM deposit_transactions
   WHERE type IN ('REFUNDED', 'FORFEITED');

  IF legacy_children > 0 THEN
    RAISE EXCEPTION
      'M3c preflight: % legacy REFUNDED/FORFEITED deposit events require explicit source reconciliation before migration',
      legacy_children;
  END IF;
END;
$m3c_legacy_preflight$ LANGUAGE plpgsql;

-- M3c — Deposit Ledger / Refund / Expense / Reversal.
-- Additive and non-destructive:
--   * ReversalSourceType enum (CHARGE/PAYMENT/DEPOSIT/EXPENSE) for the append-only
--     LedgerReversal correction event (D-02: full void, never a partial reversal).
--   * PaymentMethod.DEPOSIT_APPLICATION: internal, non-cash settlement Payment issued
--     by the D-10 deposit application. Never accepted as an Expense payment method.
--   * deposit_transactions.actor_user_id / expenses.actor_user_id: server-side actor
--     for every financial event (D-18). Existing rows keep NULL (never guessed).
--   * ledger_reversals / payment_refunds / deposit_applications: append-only tables.
--   * deposit_transactions composite unique keys so applications can be
--     tenant+resident scoped via composite FK (no cross-tenant/cross-resident leak).
--   * domain CHECKs (positive amounts) and BEFORE DELETE triggers (financial
--     documents are immutably append-only — D-18).

-- CreateEnum
CREATE TYPE "ReversalSourceType" AS ENUM ('CHARGE', 'PAYMENT', 'DEPOSIT', 'EXPENSE');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'DEPOSIT_APPLICATION';

-- AlterTable
ALTER TABLE "deposit_transactions" ADD COLUMN     "actor_user_id" UUID;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "actor_user_id" UUID;

-- AlterTable
-- DEPOSIT_APPLICATION payments are internal, non-cash settlements and carry no
-- receipt number (D-10/D-03); the official receipt number stays required for every
-- cash/bank/mobile/other receipt.
ALTER TABLE "payments" ALTER COLUMN "receipt_number" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ledger_reversals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID,
    "source_type" "ReversalSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "side" "EntrySide" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "deposit_transaction_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_reversals_organization_id_source_type_source_id_idx" ON "ledger_reversals"("organization_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "ledger_reversals_organization_id_resident_id_idx" ON "ledger_reversals"("organization_id", "resident_id");

-- CreateIndex
CREATE INDEX "ledger_reversals_actor_user_id_idx" ON "ledger_reversals"("actor_user_id");

-- CreateIndex
CREATE INDEX "payment_refunds_organization_id_payment_id_idx" ON "payment_refunds"("organization_id", "payment_id");

-- CreateIndex
CREATE INDEX "payment_refunds_organization_id_resident_id_payment_id_idx" ON "payment_refunds"("organization_id", "resident_id", "payment_id");

-- CreateIndex
CREATE INDEX "payment_refunds_actor_user_id_idx" ON "payment_refunds"("actor_user_id");

-- CreateIndex
CREATE INDEX "deposit_applications_organization_id_deposit_transaction_id_idx" ON "deposit_applications"("organization_id", "deposit_transaction_id");

-- CreateIndex
CREATE INDEX "deposit_applications_organization_id_resident_id_deposit_tr_idx" ON "deposit_applications"("organization_id", "resident_id", "deposit_transaction_id");

-- CreateIndex
CREATE INDEX "deposit_applications_organization_id_resident_id_charge_id_idx" ON "deposit_applications"("organization_id", "resident_id", "charge_id");

-- CreateIndex
CREATE INDEX "deposit_applications_actor_user_id_idx" ON "deposit_applications"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_transactions_organization_id_id_key" ON "deposit_transactions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_transactions_organization_id_resident_id_id_key" ON "deposit_transactions"("organization_id", "resident_id", "id");

-- AddForeignKey
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_reversals" ADD CONSTRAINT "ledger_reversals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_reversals" ADD CONSTRAINT "ledger_reversals_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_reversals" ADD CONSTRAINT "ledger_reversals_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_organization_id_resident_id_payment_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "payment_id") REFERENCES "payments"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_organization_id_resident_id_deposit_t_fkey" FOREIGN KEY ("organization_id", "resident_id", "deposit_transaction_id") REFERENCES "deposit_transactions"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_organization_id_resident_id_charge_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "charge_id") REFERENCES "charges"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- M3c domain CHECK constraints (raw SQL; Prisma cannot model CHECKs).
-- Every financial event carries a positive, integer AFN amount (A-016); negative
-- or zero amounts are rejected at the database level.
ALTER TABLE "ledger_reversals" ADD CONSTRAINT "ledger_reversals_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_amount_positive" CHECK ("amount" > 0);

-- Defense-in-depth: financial documents are append-only; direct physical DELETE is
-- blocked at the database level (D-18). Reuses the generic function created in
-- 20261111000000_m3b_financial_immutability; no new function is needed.
CREATE TRIGGER "deposit_transactions_prevent_delete" BEFORE DELETE ON "deposit_transactions" FOR EACH ROW EXECUTE FUNCTION "prevent_financial_document_delete"();
CREATE TRIGGER "expenses_prevent_delete" BEFORE DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION "prevent_financial_document_delete"();
CREATE TRIGGER "ledger_reversals_prevent_delete" BEFORE DELETE ON "ledger_reversals" FOR EACH ROW EXECUTE FUNCTION "prevent_financial_document_delete"();
CREATE TRIGGER "payment_refunds_prevent_delete" BEFORE DELETE ON "payment_refunds" FOR EACH ROW EXECUTE FUNCTION "prevent_financial_document_delete"();
CREATE TRIGGER "deposit_applications_prevent_delete" BEFORE DELETE ON "deposit_applications" FOR EACH ROW EXECUTE FUNCTION "prevent_financial_document_delete"();
