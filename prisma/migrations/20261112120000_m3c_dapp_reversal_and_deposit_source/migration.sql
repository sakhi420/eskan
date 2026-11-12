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

-- Legacy REFUNDED/FORFEITED rows are checked before any M3c DDL by the first
-- M3c migration. Do not move that preflight here: this second migration must not
-- be reached unless the first migration's fail-closed data check has succeeded.
-- 1. Deposit source linkage.
ALTER TABLE "deposit_transactions" ADD COLUMN "source_deposit_transaction_id" UUID;

CREATE INDEX "deposit_transactions_organization_id_resident_id_source_dep_idx"
  ON "deposit_transactions"("organization_id", "resident_id", "source_deposit_transaction_id");

ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_organization_id_resident_id_source_de_fkey"
  FOREIGN KEY ("organization_id", "resident_id", "source_deposit_transaction_id")
  REFERENCES "deposit_transactions"("organization_id", "resident_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A source link is valid only for a REFUNDED/FORFEITED child event and must
-- point to a still-posted RECEIVED source in the same tenant/resident. RECEIVED
-- events themselves cannot carry a parent link.
CREATE OR REPLACE FUNCTION enforce_deposit_source_linkage()
RETURNS trigger AS $m3c_source$
DECLARE
  v_source_type "DepositType";
  v_source_status "LedgerEntryStatus";
  v_source_amount INTEGER;
  v_source_used BIGINT;
BEGIN
  IF NEW.status <> 'POSTED'
     OR NEW.reversed_by_id IS NOT NULL
     OR NEW.reversal_reason IS NOT NULL
     OR NEW.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'New deposit events must be POSTED and cannot carry reversal metadata'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.type = 'RECEIVED' THEN
    IF NEW.source_deposit_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'RECEIVED deposit events cannot have a source deposit link'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.source_deposit_transaction_id IS NULL THEN
      RAISE EXCEPTION 'REFUNDED/FORFEITED deposit events require a source RECEIVED deposit'
        USING ERRCODE = '23514';
    END IF;

    SELECT dt.type, dt.status, dt.amount
      INTO v_source_type, v_source_status, v_source_amount
      FROM deposit_transactions AS dt
     WHERE dt.id = NEW.source_deposit_transaction_id
       AND dt.organization_id = NEW.organization_id
       AND dt.resident_id = NEW.resident_id
     FOR UPDATE;

    IF NOT FOUND OR v_source_type <> 'RECEIVED' OR v_source_status <> 'POSTED'
       OR EXISTS (
         SELECT 1
           FROM ledger_reversals AS lr
          WHERE lr.organization_id = NEW.organization_id
            AND lr.source_type = 'DEPOSIT'
            AND lr.source_id = NEW.source_deposit_transaction_id
       ) THEN
      RAISE EXCEPTION 'Deposit refund/forfeit source must be an unreversed POSTED RECEIVED event'
        USING ERRCODE = '23514';
    END IF;

    -- The source row is locked above, so concurrent direct-SQL refunds,
    -- forfeitures, and DAPP applications serialize before this aggregate check.
    SELECT
      COALESCE((
        SELECT SUM(dt.amount)::BIGINT
          FROM deposit_transactions AS dt
         WHERE dt.organization_id = NEW.organization_id
           AND dt.resident_id = NEW.resident_id
           AND dt.source_deposit_transaction_id = NEW.source_deposit_transaction_id
           AND dt.status = 'POSTED'
           AND NOT EXISTS (
             SELECT 1 FROM ledger_reversals AS lr
              WHERE lr.organization_id = dt.organization_id
                AND lr.source_type = 'DEPOSIT'
                AND lr.source_id = dt.id
           )
      ), 0)
      + COALESCE((
        SELECT SUM(da.amount)::BIGINT
          FROM deposit_applications AS da
         WHERE da.organization_id = NEW.organization_id
           AND da.resident_id = NEW.resident_id
           AND da.deposit_transaction_id = NEW.source_deposit_transaction_id
           AND da.status = 'POSTED'
      ), 0)
      INTO v_source_used;

    IF v_source_used + NEW.amount::BIGINT > v_source_amount::BIGINT THEN
      RAISE EXCEPTION
        'Deposit source balance exceeded by refund/forfeit: source %, already used %, attempted %',
        v_source_amount, v_source_used, NEW.amount
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$m3c_source$ LANGUAGE plpgsql;

CREATE TRIGGER deposit_transactions_validate_source_link
  BEFORE INSERT ON deposit_transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_deposit_source_linkage();

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

-- Every externally received payment must retain its official receipt number.
-- The internal DAPP settlement is the only payment type that is receipt-less.
ALTER TABLE "payments" ADD CONSTRAINT "payments_manual_requires_receipt"
  CHECK ("method" = 'DEPOSIT_APPLICATION' OR "receipt_number" IS NOT NULL);

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
  deposit_type "DepositType";
  deposit_status "LedgerEntryStatus";
  deposit_amount INTEGER;
  source_used BIGINT;
  charge_status "LedgerEntryStatus";
  charge_entry_side "EntrySide";
  payment_method "PaymentMethod";
  payment_receipt TEXT;
  payment_amount INTEGER;
  allocation_payment_id UUID;
  allocation_charge_id UUID;
  allocation_amount INTEGER;
BEGIN
  IF NEW.status <> 'POSTED'
     OR NEW.reversed_by_id IS NOT NULL
     OR NEW.reversal_reason IS NOT NULL
     OR NEW.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'New DepositApplication rows must be POSTED and cannot carry reversal metadata'
      USING ERRCODE = '23514';
  END IF;

  SELECT type, status, amount
    INTO deposit_type, deposit_status, deposit_amount
    FROM deposit_transactions
   WHERE id = NEW.deposit_transaction_id
     AND organization_id = NEW.organization_id
     AND resident_id = NEW.resident_id
   FOR UPDATE;

  IF NOT FOUND OR deposit_type <> 'RECEIVED' OR deposit_status <> 'POSTED'
     OR EXISTS (
       SELECT 1 FROM ledger_reversals
        WHERE organization_id = NEW.organization_id
          AND source_type = 'DEPOSIT'
          AND source_id = NEW.deposit_transaction_id
     ) THEN
    RAISE EXCEPTION 'DepositApplication must consume an unreversed POSTED RECEIVED deposit'
      USING ERRCODE = '23514';
  END IF;

  -- Use the same source-scoped balance formula as the application service:
  -- un-reversed child events plus POSTED applications consume the RECEIVED row.
  SELECT
    COALESCE((
      SELECT SUM(dt.amount)::BIGINT
        FROM deposit_transactions AS dt
       WHERE dt.organization_id = NEW.organization_id
         AND dt.resident_id = NEW.resident_id
         AND dt.source_deposit_transaction_id = NEW.deposit_transaction_id
         AND dt.status = 'POSTED'
         AND NOT EXISTS (
           SELECT 1 FROM ledger_reversals AS lr
            WHERE lr.organization_id = dt.organization_id
              AND lr.source_type = 'DEPOSIT'
              AND lr.source_id = dt.id
         )
    ), 0)
    + COALESCE((
      SELECT SUM(da.amount)::BIGINT
        FROM deposit_applications AS da
       WHERE da.organization_id = NEW.organization_id
         AND da.resident_id = NEW.resident_id
         AND da.deposit_transaction_id = NEW.deposit_transaction_id
         AND da.status = 'POSTED'
    ), 0)
    INTO source_used;

  IF source_used + NEW.amount::BIGINT > deposit_amount::BIGINT THEN
    RAISE EXCEPTION
      'Deposit source balance exceeded by application: source %, already used %, attempted %',
      deposit_amount, source_used, NEW.amount
      USING ERRCODE = '23514';
  END IF;

  SELECT status, entry_side
    INTO charge_status, charge_entry_side
    FROM charges
   WHERE id = NEW.charge_id
     AND organization_id = NEW.organization_id
     AND resident_id = NEW.resident_id
   FOR UPDATE;

  IF NOT FOUND OR charge_status <> 'POSTED' OR charge_entry_side <> 'DEBIT' THEN
    RAISE EXCEPTION 'DepositApplication must settle a POSTED DEBIT charge'
      USING ERRCODE = '23514';
  END IF;

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
     AND resident_id = NEW.resident_id
   FOR UPDATE;

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
  IF (OLD.method = 'DEPOSIT_APPLICATION' OR NEW.method = 'DEPOSIT_APPLICATION') AND ROW(
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

-- Refund and LedgerReversal rows are immutable events: corrections require a
-- compensating event, never UPDATE. DepositApplication and Expense are handled
-- separately because their reversal state is intentionally mutable.
CREATE OR REPLACE FUNCTION prevent_financial_document_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ESKAN_FINANCIAL_IMMUTABILITY: % rows are append-only and cannot be updated', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_reversals_prevent_update
  BEFORE UPDATE ON ledger_reversals
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_document_update();

CREATE TRIGGER payment_refunds_prevent_update
  BEFORE UPDATE ON payment_refunds
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_document_update();

-- Expense reversal may update status/version/reversal metadata, but its posted
-- financial identity (tenant, category, amount, date, method, description and
-- actor) cannot be rewritten. A hostel may only be detached by ON DELETE SET NULL;
-- it cannot be reassigned to another hostel.
CREATE OR REPLACE FUNCTION prevent_expense_financial_identity_update()
RETURNS trigger AS $$
BEGIN
  IF ROW(
       NEW.organization_id, NEW.category, NEW.amount, NEW.spent_at,
       NEW.payment_method, NEW.description, NEW.actor_user_id, NEW.created_at
     ) IS DISTINCT FROM ROW(
       OLD.organization_id, OLD.category, OLD.amount, OLD.spent_at,
       OLD.payment_method, OLD.description, OLD.actor_user_id, OLD.created_at
     )
     OR (NEW.hostel_id IS NOT NULL AND NEW.hostel_id IS DISTINCT FROM OLD.hostel_id) THEN
    RAISE EXCEPTION 'ESKAN_FINANCIAL_IMMUTABILITY: expense financial identity cannot be rewritten'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expenses_prevent_financial_identity_update
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION prevent_expense_financial_identity_update();

-- A Charge that is settled by a still-posted DepositApplication cannot be
-- reversed independently. The dedicated application reversal must first restore
-- Deposit Held and release its DAPP allocation; this guard also protects direct SQL.
CREATE OR REPLACE FUNCTION prevent_charge_reversal_with_active_deposit_application()
RETURNS trigger AS $m3c_charge_guard$
BEGIN
  IF OLD.status = 'POSTED'
     AND NEW.status = 'REVERSED'
     AND EXISTS (
       SELECT 1
         FROM deposit_applications AS da
        WHERE da.organization_id = OLD.organization_id
          AND da.charge_id = OLD.id
          AND da.status = 'POSTED'
     ) THEN
    RAISE EXCEPTION
      'Charge cannot be reversed while a posted DepositApplication exists; reverse the application first'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$m3c_charge_guard$ LANGUAGE plpgsql;

CREATE TRIGGER charges_prevent_reverse_with_active_deposit_application
  BEFORE UPDATE OF status ON charges
  FOR EACH ROW EXECUTE FUNCTION prevent_charge_reversal_with_active_deposit_application();
