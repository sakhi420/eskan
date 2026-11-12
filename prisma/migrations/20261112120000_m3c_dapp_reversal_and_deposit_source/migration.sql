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

-- D-18 / section 4.4: DepositTransaction postings are strictly append-only.
-- A void is represented only by LedgerReversal; source rows are never UPDATEd.
CREATE OR REPLACE FUNCTION prevent_deposit_transaction_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deposit_transactions are append-only; UPDATE is forbidden'
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deposit_transactions_prevent_update
  BEFORE UPDATE ON deposit_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_deposit_transaction_update();

-- P1-4: a DepositApplication must reference the exact DAPP Payment and its
-- Allocation (same payment, charge and amount), not merely rows in the same tenant.
CREATE OR REPLACE FUNCTION enforce_deposit_application_linkage()
RETURNS trigger AS $$
DECLARE
  payment_method "PaymentMethod";
  payment_receipt TEXT;
  payment_amount INTEGER;
  allocation_payment_id UUID;
  allocation_charge_id UUID;
  allocation_amount INTEGER;
BEGIN
  SELECT method, receipt_number, amount
    INTO payment_method, payment_receipt, payment_amount
    FROM payments
   WHERE id = NEW.payment_id
     AND organization_id = NEW.organization_id
     AND resident_id = NEW.resident_id;

  IF NOT FOUND
     OR payment_method <> 'DEPOSIT_APPLICATION'
     OR payment_receipt IS NOT NULL
     OR payment_amount <> NEW.amount THEN
    RAISE EXCEPTION 'DepositApplication must reference a matching non-cash DAPP Payment'
      USING ERRCODE = '23514';
  END IF;

  SELECT payment_id, charge_id, amount
    INTO allocation_payment_id, allocation_charge_id, allocation_amount
    FROM payment_allocations
   WHERE id = NEW.allocation_id
     AND organization_id = NEW.organization_id
     AND resident_id = NEW.resident_id;

  IF NOT FOUND
     OR allocation_payment_id <> NEW.payment_id
     OR allocation_charge_id <> NEW.charge_id
     OR allocation_amount <> NEW.amount THEN
    RAISE EXCEPTION 'DepositApplication must reference the exact matching PaymentAllocation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deposit_applications_validate_links
  BEFORE INSERT ON deposit_applications
  FOR EACH ROW EXECUTE FUNCTION enforce_deposit_application_linkage();

-- No extra Allocation may be attached to a DAPP Payment. Lock the parent Payment
-- so concurrent INSERT attempts serialize before the one-allocation check.
CREATE OR REPLACE FUNCTION enforce_dapp_single_allocation()
RETURNS trigger AS $$
DECLARE
  payment_method "PaymentMethod";
  payment_amount INTEGER;
BEGIN
  SELECT method, amount
    INTO payment_method, payment_amount
    FROM payments
   WHERE id = NEW.payment_id
     AND organization_id = NEW.organization_id
     AND resident_id = NEW.resident_id
   FOR UPDATE;

  IF FOUND AND payment_method = 'DEPOSIT_APPLICATION' THEN
    IF NEW.amount <> payment_amount OR EXISTS (
      SELECT 1 FROM payment_allocations
       WHERE organization_id = NEW.organization_id
         AND resident_id = NEW.resident_id
         AND payment_id = NEW.payment_id
    ) THEN
      RAISE EXCEPTION 'DEPOSIT_APPLICATION must have exactly one full-amount allocation'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocations_enforce_dapp_single_allocation
  BEFORE INSERT ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION enforce_dapp_single_allocation();

-- The linked DAPP Payment's financial identity cannot be rewritten after posting.
-- Status/version/reversal metadata remain mutable for the dedicated reverse flow.
CREATE OR REPLACE FUNCTION prevent_dapp_payment_identity_update()
RETURNS trigger AS $$
BEGIN
  IF OLD.method = 'DEPOSIT_APPLICATION' AND ROW(
    NEW.organization_id, NEW.resident_id, NEW.amount, NEW.method, NEW.receipt_number
  ) IS DISTINCT FROM ROW(
    OLD.organization_id, OLD.resident_id, OLD.amount, OLD.method, OLD.receipt_number
  ) THEN
    RAISE EXCEPTION 'DEPOSIT_APPLICATION payment identity is immutable'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_prevent_dapp_identity_update
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION prevent_dapp_payment_identity_update();

-- A linked PaymentAllocation is the financial identity of one DepositApplication.
CREATE OR REPLACE FUNCTION prevent_dapp_allocation_update()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM deposit_applications
     WHERE organization_id = OLD.organization_id
       AND resident_id = OLD.resident_id
       AND allocation_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'DAPP PaymentAllocation identity is immutable'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocations_prevent_dapp_update
  BEFORE UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION prevent_dapp_allocation_update();

-- A DepositApplication's financial identity is immutable; only status/reversal
-- metadata may change through reverseApplication().
CREATE OR REPLACE FUNCTION prevent_deposit_application_link_mutation()
RETURNS trigger AS $$
BEGIN
  IF ROW(
       NEW.organization_id, NEW.resident_id, NEW.deposit_transaction_id,
       NEW.charge_id, NEW.payment_id, NEW.allocation_id, NEW.amount,
       NEW.reason, NEW.actor_user_id, NEW.created_at
     ) IS DISTINCT FROM ROW(
       OLD.organization_id, OLD.resident_id, OLD.deposit_transaction_id,
       OLD.charge_id, OLD.payment_id, OLD.allocation_id, OLD.amount,
       OLD.reason, OLD.actor_user_id, OLD.created_at
     ) THEN
    RAISE EXCEPTION 'deposit_application financial identity is immutable'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deposit_applications_prevent_link_update
  BEFORE UPDATE ON deposit_applications
  FOR EACH ROW EXECUTE FUNCTION prevent_deposit_application_link_mutation();
