-- StayContract must carry the same basic range-sanity CHECK as bed_assignments
-- so that checkout (or any future date edit) can never persist a contract where
-- endDate <= startDate. The application already rejects this on create/update,
-- but checkout was able to produce an invalid historical range (endDate set to
-- a business date on or before startDate) and the DB had no backstop for it.
--
-- IMPORTANT: this migration intentionally does NOT mutate existing rows. If an
-- existing contract violates this rule, the ADD CONSTRAINT below fails with
-- SQLSTATE 23514 and the operator must resolve the conflict through an
-- explicit, audited data-fix before re-running. Production data is never
-- silently rewritten.

ALTER TABLE "stay_contracts" DROP CONSTRAINT IF EXISTS "stay_contracts_date_range_valid";

ALTER TABLE "stay_contracts"
  ADD CONSTRAINT "stay_contracts_date_range_valid"
  CHECK ("end_date" IS NULL OR "end_date" > "start_date");