-- A resident must never hold two overlapping ACTIVE stay contracts at the same
-- time. This mirrors the bed_assignment resident-level exclusion and enforces
-- it at the database layer as the final backstop for the contract-activation
-- overlap check.
--
-- IMPORTANT: this migration intentionally does NOT mutate existing rows. If
-- unresolved overlapping ACTIVE contracts remain, the ADD CONSTRAINT statement
-- fails with SQLSTATE 23P01 and the operator must resolve the conflict through
-- an explicit, audited data-fix before re-running. Production data is never
-- silently rewritten.
--
-- DRAFT contracts are intentionally excluded: a resident may hold any number
-- of draft contracts while one is being prepared for activation.

ALTER TABLE "stay_contracts" DROP CONSTRAINT IF EXISTS "stay_contracts_resident_no_overlap";

ALTER TABLE "stay_contracts"
  ADD CONSTRAINT "stay_contracts_resident_no_overlap"
  EXCLUDE USING gist (
    "resident_id" WITH =,
    daterange("start_date", COALESCE("end_date", 'infinity'::date), '[)') WITH &&
  )
  WHERE ("status" = 'ACTIVE');