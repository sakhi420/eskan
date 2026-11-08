-- M-2: tenant/resident-scoped composite integrity (Prisma-managed composite FKs).
--
-- The composite FKs and their supporting indexes are generated to match the Prisma
-- schema exactly (same constraint names, ON UPDATE CASCADE), so a later
-- `prisma migrate diff` is empty and Prisma never drops them. NULLABLE-parent
-- relationships keep their single-column FK (ON DELETE SET NULL) plus a composite
-- scope FK (ON DELETE NO ACTION); Prisma models both (optional relation + named
-- tenant relation). PaymentAllocation drops the (paymentId, chargeId) unique to
-- permit re-allocation after release (phase-9-engineering-plan F-19).
--
-- Transactionality: explicit BEGIN/COMMIT; preflight runs BEFORE any DDL.

BEGIN;

-- Preflight FIRST. Count every anomaly the new composite FKs/trigger would
-- reject, and abort (rolling everything back) with actionable per-table counts
-- if ANY is non-zero. No row is auto-corrected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad_room_hostel_org        integer;
  bad_bed_room_org           integer;
  bad_contract_hostel_org    integer;
  bad_contract_resident_org  integer;
  bad_asg_bed_org            integer;
  bad_asg_resident_org       integer;
  bad_asg_contract_org       integer;
  bad_asg_contract_res       integer;
  bad_charge_resident_org    integer;
  bad_charge_contract_org    integer;
  bad_charge_contract_res    integer;
  bad_payment_resident_org   integer;
  bad_deposit_resident_org   integer;
  bad_expense_hostel_org     integer;
  bad_absence_resident_org   integer;
  bad_absence_contract_org   integer;
  bad_absence_contract_res   integer;
  bad_absence_credit_org     integer;
  bad_absence_credit_res     integer;
  bad_package_hostel_org     integer;
  bad_contract_package_org   integer;
  bad_contract_package_hostel integer;
  bad_alloc_payment_charge   integer;
BEGIN
  SELECT count(*) INTO bad_room_hostel_org
    FROM rooms r JOIN hostels h ON h.id = r.hostel_id WHERE r.organization_id <> h.organization_id;
  SELECT count(*) INTO bad_bed_room_org
    FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.organization_id <> r.organization_id;
  SELECT count(*) INTO bad_contract_hostel_org
    FROM stay_contracts sc JOIN hostels h ON h.id = sc.hostel_id WHERE sc.organization_id <> h.organization_id;
  SELECT count(*) INTO bad_contract_resident_org
    FROM stay_contracts sc JOIN residents r ON r.id = sc.resident_id WHERE sc.organization_id <> r.organization_id;
  SELECT count(*) INTO bad_asg_bed_org
    FROM bed_assignments a JOIN beds b ON b.id = a.bed_id WHERE a.organization_id <> b.organization_id;
  SELECT count(*) INTO bad_asg_resident_org
    FROM bed_assignments a JOIN residents r ON r.id = a.resident_id WHERE a.organization_id <> r.organization_id;
  SELECT count(*) INTO bad_asg_contract_org
    FROM bed_assignments a JOIN stay_contracts sc ON sc.id = a.contract_id WHERE a.organization_id <> sc.organization_id;
  SELECT count(*) INTO bad_asg_contract_res
    FROM bed_assignments a JOIN stay_contracts sc ON sc.id = a.contract_id WHERE a.resident_id <> sc.resident_id;
SELECT count(*) INTO bad_charge_resident_org
    FROM charges c JOIN residents r ON r.id = c.resident_id WHERE c.organization_id <> r.organization_id;
  SELECT count(*) INTO bad_charge_contract_org
    FROM charges c JOIN stay_contracts sc ON sc.id = c.contract_id WHERE c.organization_id <> sc.organization_id;
  SELECT count(*) INTO bad_charge_contract_res
    FROM charges c JOIN stay_contracts sc ON sc.id = c.contract_id WHERE c.resident_id <> sc.resident_id;
  SELECT count(*) INTO bad_payment_resident_org
    FROM payments p JOIN residents r ON r.id = p.resident_id WHERE p.organization_id <> r.organization_id;
  SELECT count(*) INTO bad_deposit_resident_org
    FROM deposit_transactions d JOIN residents r ON r.id = d.resident_id WHERE d.organization_id <> r.organization_id;
  SELECT count(*) INTO bad_expense_hostel_org
    FROM expenses e JOIN hostels h ON h.id = e.hostel_id WHERE e.organization_id <> h.organization_id;
  SELECT count(*) INTO bad_absence_resident_org
    FROM temporary_absences ta JOIN residents r ON r.id = ta.resident_id WHERE ta.organization_id <> r.organization_id;
  SELECT count(*) INTO bad_absence_contract_org
    FROM temporary_absences ta JOIN stay_contracts sc ON sc.id = ta.contract_id WHERE ta.organization_id <> sc.organization_id;
  SELECT count(*) INTO bad_absence_contract_res
    FROM temporary_absences ta JOIN stay_contracts sc ON sc.id = ta.contract_id WHERE ta.resident_id <> sc.resident_id;
  SELECT count(*) INTO bad_absence_credit_org
    FROM temporary_absences ta JOIN charges c ON c.id = ta.credit_charge_id WHERE ta.organization_id <> c.organization_id;
  SELECT count(*) INTO bad_absence_credit_res
    FROM temporary_absences ta JOIN charges c ON c.id = ta.credit_charge_id WHERE ta.resident_id <> c.resident_id;
  SELECT count(*) INTO bad_package_hostel_org
    FROM accommodation_packages p JOIN hostels h ON h.id = p.hostel_id WHERE p.organization_id <> h.organization_id;
  SELECT count(*) INTO bad_contract_package_org
    FROM stay_contracts sc JOIN accommodation_packages p ON p.id = sc.package_id WHERE sc.organization_id <> p.organization_id;
  SELECT count(*) INTO bad_contract_package_hostel
    FROM stay_contracts sc JOIN accommodation_packages p ON p.id = sc.package_id
    WHERE p.hostel_id IS NOT NULL AND sc.hostel_id <> p.hostel_id;
  SELECT count(*) INTO bad_alloc_payment_charge
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    JOIN charges c ON c.id = pa.charge_id
    WHERE p.organization_id <> c.organization_id OR p.resident_id <> c.resident_id;

  IF bad_room_hostel_org + bad_bed_room_org + bad_contract_hostel_org + bad_contract_resident_org
     + bad_asg_bed_org + bad_asg_resident_org + bad_asg_contract_org + bad_asg_contract_res
     + bad_charge_resident_org + bad_charge_contract_org + bad_charge_contract_res
     + bad_payment_resident_org + bad_deposit_resident_org + bad_expense_hostel_org
     + bad_absence_resident_org + bad_absence_contract_org + bad_absence_contract_res
     + bad_absence_credit_org + bad_absence_credit_res + bad_package_hostel_org
     + bad_contract_package_org + bad_contract_package_hostel + bad_alloc_payment_charge > 0 THEN
    RAISE EXCEPTION
      'M-2 preflight failed: room_hostel=% bed_room=% contract_hostel=% contract_resident=% asg_bed=% asg_resident=% asg_contract_org=% asg_contract_res=% charge_resident=% charge_contract_org=% charge_contract_res=% payment_resident=% deposit_resident=% expense_hostel=% absence_resident=% absence_contract_org=% absence_contract_res=% absence_credit_org=% absence_credit_res=% package_hostel=% contract_package=% contract_package_hostel=% alloc_payment_charge=%',
      bad_room_hostel_org, bad_bed_room_org, bad_contract_hostel_org, bad_contract_resident_org,
      bad_asg_bed_org, bad_asg_resident_org, bad_asg_contract_org, bad_asg_contract_res,
      bad_charge_resident_org, bad_charge_contract_org, bad_charge_contract_res,
      bad_payment_resident_org, bad_deposit_resident_org, bad_expense_hostel_org,
      bad_absence_resident_org, bad_absence_contract_org, bad_absence_contract_res,
      bad_absence_credit_org, bad_absence_credit_res, bad_package_hostel_org,
      bad_contract_package_org, bad_contract_package_hostel, bad_alloc_payment_charge;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "bed_assignments" DROP CONSTRAINT "bed_assignments_bed_id_fkey";

-- DropForeignKey
ALTER TABLE "bed_assignments" DROP CONSTRAINT "bed_assignments_contract_id_fkey";

-- DropForeignKey
ALTER TABLE "bed_assignments" DROP CONSTRAINT "bed_assignments_resident_id_fkey";

-- DropForeignKey
ALTER TABLE "beds" DROP CONSTRAINT "beds_room_id_fkey";

-- DropForeignKey
ALTER TABLE "charges" DROP CONSTRAINT "charges_resident_id_fkey";

-- DropForeignKey
ALTER TABLE "deposit_transactions" DROP CONSTRAINT "deposit_transactions_resident_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_charge_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_resident_id_fkey";

-- DropForeignKey
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_hostel_id_fkey";

-- DropForeignKey
ALTER TABLE "stay_contracts" DROP CONSTRAINT "stay_contracts_hostel_id_fkey";

-- DropForeignKey
ALTER TABLE "stay_contracts" DROP CONSTRAINT "stay_contracts_resident_id_fkey";

-- DropForeignKey
ALTER TABLE "temporary_absences" DROP CONSTRAINT "temporary_absences_contract_id_fkey";

-- DropForeignKey
ALTER TABLE "temporary_absences" DROP CONSTRAINT "temporary_absences_resident_id_fkey";

-- DropIndex
DROP INDEX "payment_allocations_payment_id_charge_id_key";

-- ---------------------------------------------------------------------------
-- PaymentAllocation: add nullable columns, backfill from Payment, tighten to
-- NOT NULL, then swap its two FKs for composite FKs (below).
-- ---------------------------------------------------------------------------
ALTER TABLE "payment_allocations"
  ADD COLUMN "organization_id" UUID,
  ADD COLUMN "resident_id"     UUID;

UPDATE "payment_allocations" pa
SET "organization_id" = p.organization_id,
    "resident_id"     = p.resident_id
FROM "payments" p
WHERE pa.payment_id = p.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "payment_allocations" WHERE "organization_id" IS NULL OR "resident_id" IS NULL) THEN
    RAISE EXCEPTION 'M-2 preflight failed: payment_allocations has unresolved organization/resident after backfill';
  END IF;
END $$;

ALTER TABLE "payment_allocations"
  ALTER COLUMN "organization_id" SET NOT NULL,
  ALTER COLUMN "resident_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "accommodation_packages_organization_id_id_key" ON "accommodation_packages"("organization_id", "id");

-- CreateIndex
CREATE INDEX "bed_assignments_organization_id_resident_id_contract_id_idx" ON "bed_assignments"("organization_id", "resident_id", "contract_id");

-- CreateIndex
CREATE INDEX "beds_organization_id_room_id_idx" ON "beds"("organization_id", "room_id");

-- CreateIndex
CREATE UNIQUE INDEX "beds_organization_id_id_key" ON "beds"("organization_id", "id");

-- CreateIndex
CREATE INDEX "charges_organization_id_resident_id_contract_id_idx" ON "charges"("organization_id", "resident_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "charges_organization_id_id_key" ON "charges"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "charges_organization_id_resident_id_id_key" ON "charges"("organization_id", "resident_id", "id");

-- CreateIndex
CREATE INDEX "expenses_organization_id_hostel_id_idx" ON "expenses"("organization_id", "hostel_id");

-- CreateIndex
CREATE UNIQUE INDEX "hostels_organization_id_id_key" ON "hostels"("organization_id", "id");

-- CreateIndex
CREATE INDEX "payment_allocations_organization_id_resident_id_payment_id_idx" ON "payment_allocations"("organization_id", "resident_id", "payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_organization_id_resident_id_charge_id_idx" ON "payment_allocations"("organization_id", "resident_id", "charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_id_key" ON "payments"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_resident_id_id_key" ON "payments"("organization_id", "resident_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "residents_organization_id_id_key" ON "residents"("organization_id", "id");

-- CreateIndex
CREATE INDEX "rooms_organization_id_hostel_id_idx" ON "rooms"("organization_id", "hostel_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_organization_id_id_key" ON "rooms"("organization_id", "id");

-- CreateIndex
CREATE INDEX "stay_contracts_organization_id_package_id_idx" ON "stay_contracts"("organization_id", "package_id");

-- CreateIndex
CREATE UNIQUE INDEX "stay_contracts_organization_id_id_key" ON "stay_contracts"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stay_contracts_organization_id_resident_id_id_key" ON "stay_contracts"("organization_id", "resident_id", "id");

-- CreateIndex
CREATE INDEX "temporary_absences_organization_id_resident_id_contract_id_idx" ON "temporary_absences"("organization_id", "resident_id", "contract_id");

-- CreateIndex
CREATE INDEX "temporary_absences_organization_id_resident_id_credit_charg_idx" ON "temporary_absences"("organization_id", "resident_id", "credit_charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "temporary_absences_organization_id_resident_id_id_key" ON "temporary_absences"("organization_id", "resident_id", "id");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_hostel_id_fkey" FOREIGN KEY ("organization_id", "hostel_id") REFERENCES "hostels"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accommodation_packages" ADD CONSTRAINT "accommodation_packages_organization_id_hostel_id_fkey" FOREIGN KEY ("organization_id", "hostel_id") REFERENCES "hostels"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_organization_id_resident_id_contract_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "contract_id") REFERENCES "stay_contracts"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_organization_id_resident_id_credit_char_fkey" FOREIGN KEY ("organization_id", "resident_id", "credit_charge_id") REFERENCES "charges"("organization_id", "resident_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_contracts" ADD CONSTRAINT "stay_contracts_organization_id_hostel_id_fkey" FOREIGN KEY ("organization_id", "hostel_id") REFERENCES "hostels"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_contracts" ADD CONSTRAINT "stay_contracts_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_contracts" ADD CONSTRAINT "stay_contracts_organization_id_package_id_fkey" FOREIGN KEY ("organization_id", "package_id") REFERENCES "accommodation_packages"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_organization_id_bed_id_fkey" FOREIGN KEY ("organization_id", "bed_id") REFERENCES "beds"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_organization_id_resident_id_contract_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "contract_id") REFERENCES "stay_contracts"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_organization_id_resident_id_contract_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "contract_id") REFERENCES "stay_contracts"("organization_id", "resident_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_resident_id_payment_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "payment_id") REFERENCES "payments"("organization_id", "resident_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_resident_id_charge_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "charge_id") REFERENCES "charges"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_hostel_id_fkey" FOREIGN KEY ("organization_id", "hostel_id") REFERENCES "hostels"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hostel-specific package consistency (DB-enforced, not app-only). The contract
-- trigger reads the package FOR UPDATE so a concurrent accommodation_packages
-- update (which locks the same row) serializes with contract insert/update.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "enforce_stay_contract_package_hostel"()
RETURNS trigger AS $$
DECLARE pkg_hostel uuid;
BEGIN
  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT hostel_id INTO pkg_hostel
    FROM accommodation_packages
    WHERE id = NEW.package_id
    FOR UPDATE;
  IF pkg_hostel IS NOT NULL AND pkg_hostel <> NEW.hostel_id THEN
    RAISE EXCEPTION
      'stay_contracts: package is hostel-specific; contract hostel (%) must match package hostel (%)',
      NEW.hostel_id, pkg_hostel
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "stay_contracts_package_hostel_check"
  BEFORE INSERT OR UPDATE OF hostel_id, package_id ON "stay_contracts"
  FOR EACH ROW EXECUTE FUNCTION "enforce_stay_contract_package_hostel"();

CREATE OR REPLACE FUNCTION "enforce_package_hostel_change"()
RETURNS trigger AS $$
BEGIN
  IF NEW.hostel_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM stay_contracts sc
    WHERE sc.package_id = NEW.id AND sc.hostel_id <> NEW.hostel_id
  ) THEN
    RAISE EXCEPTION
      'accommodation_packages: cannot set hostel_id (%) because contracts reference this package from another hostel',
      NEW.hostel_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "accommodation_packages_hostel_change_check"
  BEFORE UPDATE OF hostel_id ON "accommodation_packages"
  FOR EACH ROW EXECUTE FUNCTION "enforce_package_hostel_change"();

COMMIT;

