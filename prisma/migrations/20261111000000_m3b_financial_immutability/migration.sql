-- M3b acceptance remediation — financial document immutability (D-18).
-- Additive and non-destructive:
--   * payment_allocations -> payments FK changes from ON DELETE CASCADE to
--     ON DELETE RESTRICT so deleting a Payment can never cascade-delete its
--     allocations (financial documents are append-only).
--   * BEFORE DELETE triggers harden payments / payment_allocations /
--     allocation_releases against direct physical deletes at the database level.
--     There is no API delete path for financial documents; this is defense-in-depth
--     so raw SQL cannot silently erase history either.

-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_organization_id_resident_id_payment_id_fkey";

-- AddForeignKey (same composite columns, onDelete action hardened to RESTRICT)
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_resident_id_payment_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "payment_id") REFERENCES "payments"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense-in-depth: financial documents are append-only; direct DELETE is blocked.
CREATE FUNCTION "prevent_financial_document_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ESKAN_FINANCIAL_IMMUTABILITY: % rows are append-only and cannot be deleted; use a documented reversal operation instead', TG_TABLE_NAME USING ERRCODE = 'P0001';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payments_prevent_delete" BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION "prevent_financial_document_delete"();

CREATE TRIGGER "payment_allocations_prevent_delete" BEFORE DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION "prevent_financial_document_delete"();

CREATE TRIGGER "allocation_releases_prevent_delete" BEFORE DELETE ON "allocation_releases" FOR EACH ROW EXECUTE FUNCTION "prevent_financial_document_delete"();