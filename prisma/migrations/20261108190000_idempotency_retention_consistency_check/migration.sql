-- Idempotency retention consistency (Phase 9 decision 4c — final hardening).
--
-- Enforce at the database level the invariant the service already guarantees:
--   PERMANENT => expires_at IS NULL      (never lazily expired / deleted)
--   TRANSIENT => expires_at IS NOT NULL  (30-day lazy-expiry window)
--
-- No backfill or auto-correction: the preceding migration
-- (20261108180000_idempotency_retention_class) defaulted every pre-existing row
-- to retention_class = 'TRANSIENT' while leaving the previously-required
-- expires_at intact, so all existing rows already satisfy this rule. Any row
-- that would violate it is surfaced here (fail-closed) rather than silently
-- corrected.

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_retention_consistency_check"
  CHECK (
    (retention_class = 'PERMANENT' AND expires_at IS NULL)
    OR
    (retention_class = 'TRANSIENT' AND expires_at IS NOT NULL)
  );