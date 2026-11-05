-- A resident must never hold two concurrent bed assignments (even on different
-- beds). The earlier migration only excluded overlap per bed_id. This adds an
-- equivalent half-open [startDate, endDate) exclusion keyed by resident_id.

-- Backfill: before enforcing the constraint, deconflict any existing residents
-- that already hold two concurrent ACTIVE assignments. Keep the earliest-starting
-- assignment (tie-broken by id) and end the later overlapping ones, preserving
-- the rows as history rather than deleting them.
UPDATE "bed_assignments" AS ba
SET "status" = 'ENDED',
    "end_date" = CURRENT_DATE
FROM "bed_assignments" AS o
WHERE ba."resident_id" = o."resident_id"
  AND ba."id" <> o."id"
  AND ba."status" = 'ACTIVE'
  AND o."status" = 'ACTIVE'
  AND daterange(ba."start_date", COALESCE(ba."end_date", 'infinity'::date), '[)')
      && daterange(o."start_date", COALESCE(o."end_date", 'infinity'::date), '[)')
  AND (ba."start_date" > o."start_date"
       OR (ba."start_date" = o."start_date" AND ba."id" > o."id"));

ALTER TABLE "bed_assignments" DROP CONSTRAINT IF EXISTS "bed_assignments_resident_no_overlap";

ALTER TABLE "bed_assignments"
  ADD CONSTRAINT "bed_assignments_resident_no_overlap"
  EXCLUDE USING gist (
    "resident_id" WITH =,
    daterange("start_date", COALESCE("end_date", 'infinity'::date), '[)') WITH &&
  )
  WHERE ("status" = 'ACTIVE');