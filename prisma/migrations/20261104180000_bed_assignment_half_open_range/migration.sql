-- BedAssignment overlap must use half-open [startDate, endDate) semantics so that
-- "same-day handoff" (one assignment ends the same day the next begins) is allowed,
-- matching the application-level overlap check and Master Prompt section C.5.
ALTER TABLE "bed_assignments" DROP CONSTRAINT IF EXISTS "bed_assignments_no_overlap";

ALTER TABLE "bed_assignments"
  ADD CONSTRAINT "bed_assignments_no_overlap"
  EXCLUDE USING gist (
    "bed_id" WITH =,
    daterange("start_date", COALESCE("end_date", 'infinity'::date), '[)') WITH &&
  )
  WHERE ("status" = 'ACTIVE');