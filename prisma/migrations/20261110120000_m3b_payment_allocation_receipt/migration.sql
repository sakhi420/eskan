-- M3b — Payment / Receipt / Allocation / AllocationRelease.
-- Additive and non-destructive:
--   * payments.provisional_receipt_id  (offline client's local id; never the official number)
--   * receipt_counters                 (per-organization monotonically increasing counter, no yearly reset)
--   * allocation_releases              (append-only release of part/all of a payment allocation)
--   * payment_allocations unique (organization_id, resident_id, id) so a release can be
--     tenant+resident+allocation scoped via a composite FK. No lifetime unique is added on
--     (payment_id, charge_id): re-allocating the same payment to the same charge remains legal
--     after a full/partial release (uniqueness of a mutation is idempotency-managed).
--   * domain CHECK constraints that Prisma cannot model (positive release amounts, non-negative
--     counter).
-- Historical receipt numbers that are not purely numeric are never rewritten or guessed: the
-- counter is backfilled only from unambiguous whole-integer receipts, otherwise seeded lazily
-- on the next server-issued receipt (gap policy — no reuse, no yearly reset).

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "provisional_receipt_id" TEXT;

-- CreateTable
CREATE TABLE "receipt_counters" (
    "organization_id" UUID NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receipt_counters_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "allocation_releases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allocation_releases_organization_id_allocation_id_idx" ON "allocation_releases"("organization_id", "allocation_id");

-- CreateIndex
CREATE INDEX "allocation_releases_organization_id_resident_id_allocation__idx" ON "allocation_releases"("organization_id", "resident_id", "allocation_id");

-- CreateIndex
CREATE INDEX "allocation_releases_actor_user_id_idx" ON "allocation_releases"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_organization_id_resident_id_id_key" ON "payment_allocations"("organization_id", "resident_id", "id");

-- AddForeignKey
ALTER TABLE "receipt_counters" ADD CONSTRAINT "receipt_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_releases" ADD CONSTRAINT "allocation_releases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_releases" ADD CONSTRAINT "allocation_releases_organization_id_resident_id_fkey" FOREIGN KEY ("organization_id", "resident_id") REFERENCES "residents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_releases" ADD CONSTRAINT "allocation_releases_organization_id_resident_id_allocation_fkey" FOREIGN KEY ("organization_id", "resident_id", "allocation_id") REFERENCES "payment_allocations"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_releases" ADD CONSTRAINT "allocation_releases_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- M3b domain CHECK constraints (raw SQL; Prisma cannot model CHECKs).
ALTER TABLE "allocation_releases" ADD CONSTRAINT "allocation_releases_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "receipt_counters" ADD CONSTRAINT "receipt_counters_counter_non_negative" CHECK ("counter" >= 0);

-- Backfill receipt counters only from unambiguous (purely numeric) historical receipt
-- numbers; organizations whose receipts use a non-numeric/legacy format are left untouched
-- and their counter is seeded lazily on first server-issued receipt (never guessing).
INSERT INTO "receipt_counters" ("organization_id", "counter", "updated_at")
SELECT p."organization_id", MAX(p."receipt_number"::bigint), now()
FROM "payments" p
WHERE p."receipt_number" ~ '^[0-9]+$'
GROUP BY p."organization_id"
ON CONFLICT ("organization_id") DO NOTHING;