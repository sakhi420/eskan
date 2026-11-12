-- M3c remediation (additive, non-destructive):
--   * deposit_transactions.source_deposit_transaction_id — explicit structural link
--     from a REFUNDED/FORFEITED event back to its source RECEIVED deposit (P1-1);
--     balances are now source-specific, never inferred from Audit JSON.
--   * deposit_applications.payment_id / allocation_id — structural one-to-one link to
--     the internal DEPOSIT_APPLICATION Payment and its PaymentAllocation (P1-4); the
--     source of truth for DAPP reversal, not Audit JSON.
--   * deposit_applications.status / reversed_* — append-only reversal state so a
--     reversed DAPP stops counting against Deposit Held (P0-3).
--   * Defense-in-depth constraints:
--       + a DEPOSIT_APPLICATION payment must have no receipt number (P0-2),
--       + an expense payment method can never be DEPOSIT_APPLICATION (D-14/D-16).
--   Precondition: the deposit_applications table is empty wherever this migration runs
--   (it was created by the immediately preceding M3c migration and M3c has not been
--   applied to any non-throwaway environment), so the new NOT NULL columns are safe.

-- 1. Deposit source linkage.
ALTER TABLE "deposit_transactions" ADD COLUMN "source_deposit_transaction_id" UUID;

CREATE INDEX "deposit_transactions_organization_id_resident_id_source_dep_idx"
  ON "deposit_transactions"("organization_id", "resident_id", "source_deposit_transaction_id");

ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_organization_id_resident_id_source_de_fkey"
  FOREIGN KEY ("organization_id", "resident_id", "source_deposit_transaction_id")
  REFERENCES "deposit_transactions"("organization_id", "resident_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. DepositApplication structural links + reversal state.
ALTER TABLE "deposit_applications" ADD COLUMN "payment_id" UUID NOT NULL;
ALTER TABLE "deposit_applications" ADD COLUMN "allocation_id" UUID NOT NULL;
ALTER TABLE "deposit_applications" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "deposit_applications" ADD COLUMN "status" "LedgerEntryStatus" NOT NULL DEFAULT 'POSTED';
ALTER TABLE "deposit_applications" ADD COLUMN "reversed_by_id" UUID;
ALTER TABLE "deposit_applications" ADD COLUMN "reversal_reason" TEXT;
ALTER TABLE "deposit_applications" ADD COLUMN "reversed_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "deposit_applications_organization_id_resident_id_payment_id_key"
  ON "deposit_applications"("organization_id", "resident_id", "payment_id");
CREATE UNIQUE INDEX "deposit_applications_organization_id_resident_id_allocation_key"
  ON "deposit_applications"("organization_id", "resident_id", "allocation_id");

CREATE INDEX "deposit_applications_organization_id_status_idx"
  ON "deposit_applications"("organization_id", "status");

ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_organization_id_resident_id_payment_i_fkey"
  FOREIGN KEY ("organization_id", "resident_id", "payment_id")
  REFERENCES "payments"("organization_id", "resident_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_organization_id_resident_id_allocatio_fkey"
  FOREIGN KEY ("organization_id", "resident_id", "allocation_id")
  REFERENCES "payment_allocations"("organization_id", "resident_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Defense-in-depth method checks.
ALTER TABLE "payments" ADD CONSTRAINT "payments_dapp_has_no_receipt"
  CHECK ("method" <> 'DEPOSIT_APPLICATION' OR "receipt_number" IS NULL);

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_method_not_dapp"
  CHECK ("payment_method" IS NULL OR "payment_method" <> 'DEPOSIT_APPLICATION');