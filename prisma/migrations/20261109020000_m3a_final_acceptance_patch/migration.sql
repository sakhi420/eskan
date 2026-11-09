-- M3a final acceptance patch (additive, non-destructive).

-- (1) DB-enforced integrity: a RENT charge MUST reference a contract. The
--     service already enforces this, but the invariant is now enforced in the
--     database too, closing the gap for any write path that bypasses the
--     service. Fail-closed: if any historical RENT-without-contract row exists,
--     this ADD CONSTRAINT aborts.
ALTER TABLE "charges"
  ADD CONSTRAINT "charges_rent_requires_contract"
  CHECK ("type" <> 'RENT' OR "contract_id" IS NOT NULL);

-- (2) Make the RENT partial unique index predicate explicit and aligned with
--     the Phase-9 plan. A bare `WHERE type = 'RENT'` predicate does not
--     deduplicate rows sharing a NULL contract_id (Postgres treats NULLs as
--     distinct in unique indexes); the CHECK above now forbids those rows and
--     this predicate makes the intent unambiguous.
DROP INDEX "charges_rent_business_key";

CREATE UNIQUE INDEX "charges_rent_business_key"
  ON "charges"("organization_id", "contract_id", "period_start", "period_end")
  WHERE "type" = 'RENT' AND "contract_id" IS NOT NULL;