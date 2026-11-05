-- A resident must never hold two concurrent bed assignments (even on different
-- beds). The earlier migration only excluded overlap per bed_id. This adds an
-- equivalent half-open [startDate, endDate) exclusion keyed by resident_id, plus
-- a basic range-sanity CHECK.
--
-- IMPORTANT: this migration intentionally does NOT mutate existing rows.
-- If unresolved overlapping ACTIVE assignments (or invalid date ranges) remain,
-- the ADD CONSTRAINT statement below fails with SQLSTATE 23P01 / 23514, and the
-- operator must resolve the conflict through an explicit, audited data-fix
-- before re-running. Production data is never silently rewritten.

-- 1) Structurally invalid date ranges are rejected for every row from now on.
ALTER TABLE "bed_assignments" DROP CONSTRAINT IF EXISTS "bed_assignments_date_range_valid";
ALTER TABLE "bed_assignments"
  ADD CONSTRAINT "bed_assignments_date_range_valid"
  CHECK ("end_date" IS NULL OR "end_date" > "start_date");

-- 2) Resident-level single concurrent assignment.
ALTER TABLE "bed_assignments" DROP CONSTRAINT IF EXISTS "bed_assignments_resident_no_overlap";
ALTER TABLE "bed_assignments"
  ADD CONSTRAINT "bed_assignments_resident_no_overlap"
  EXCLUDE USING gist (
    "resident_id" WITH =,
    daterange("start_date", COALESCE("end_date", 'infinity'::date), '[)') WITH &&
  )
  WHERE ("status" = 'ACTIVE');