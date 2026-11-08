-- M3a — Charge / Billing / Credit engine (additive, non-destructive).
--
-- (1) EntrySide direction for charges: DEBIT (normal obligation) vs CREDIT
--     (positive-amount discounts / absence credits), per F-17 / D-02 / D-07.
-- (2) charge_package_components stores the immutable per-component package
--     snapshot for a posted charge (billing proration and absence credit
--     breakdown), per F-21.
-- (3) absence_credits: one row per calendar month for a multi-month absence,
--     uniquely keyed by (absence, period) so a single absence+period can never
--     produce two credits, per F-21 / F-23.
-- (4) billing_runs: persisted POSTED billing runs with a stable
--     (organization, periodStart, periodEnd) business key so the same rent
--     period can never be re-issued, per F-23.

-- CreateEnum
CREATE TYPE "EntrySide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "BillingRunStatus" AS ENUM ('PREVIEW', 'POSTED');

-- AlterTable
ALTER TABLE "charges" ADD COLUMN     "entry_side" "EntrySide" NOT NULL DEFAULT 'DEBIT';

-- CreateTable
CREATE TABLE "charge_package_components" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "kind" "PackageComponentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "deductible_on_absence" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "charge_package_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absence_credits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "absence_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absence_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "business_key" TEXT NOT NULL,
    "due_day_of_month" INTEGER,
    "status" "BillingRunStatus" NOT NULL DEFAULT 'POSTED',
    "total_amount" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "charge_package_components_organization_id_resident_id_charg_idx" ON "charge_package_components"("organization_id", "resident_id", "charge_id");

-- CreateIndex
CREATE INDEX "absence_credits_organization_id_resident_id_absence_id_idx" ON "absence_credits"("organization_id", "resident_id", "absence_id");

-- CreateIndex
CREATE UNIQUE INDEX "absence_credits_organization_id_absence_id_period_start_per_key" ON "absence_credits"("organization_id", "absence_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "billing_runs_organization_id_period_start_idx" ON "billing_runs"("organization_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "billing_runs_organization_id_period_start_period_end_key" ON "billing_runs"("organization_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "billing_runs_organization_id_business_key_key" ON "billing_runs"("organization_id", "business_key");

-- AddForeignKey
ALTER TABLE "charge_package_components" ADD CONSTRAINT "charge_package_components_organization_id_resident_id_char_fkey" FOREIGN KEY ("organization_id", "resident_id", "charge_id") REFERENCES "charges"("organization_id", "resident_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_credits" ADD CONSTRAINT "absence_credits_organization_id_resident_id_absence_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "absence_id") REFERENCES "temporary_absences"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_credits" ADD CONSTRAINT "absence_credits_organization_id_resident_id_charge_id_fkey" FOREIGN KEY ("organization_id", "resident_id", "charge_id") REFERENCES "charges"("organization_id", "resident_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- M3a rent business key (F-23): at most one POSTED RENT charge per
-- (organization, contract, period). Raw SQL partial unique index (Prisma cannot
-- express a partial/filtered unique index). Fail-closed: if a historical
-- duplicate existed, this CREATE UNIQUE INDEX would abort the migration.
CREATE UNIQUE INDEX "charges_rent_business_key"
  ON "charges"("organization_id", "contract_id", "period_start", "period_end")
  WHERE "type" = 'RENT';

-- M3a domain CHECK constraints (raw SQL; Prisma cannot model CHECKs).
ALTER TABLE "charges"
  ADD CONSTRAINT "charges_period_consistent"
  CHECK ("period_start" < "period_end");

ALTER TABLE "charge_package_components"
  ADD CONSTRAINT "charge_package_components_amount_nonnegative"
  CHECK ("amount" >= 0);

ALTER TABLE "absence_credits"
  ADD CONSTRAINT "absence_credits_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "absence_credits"
  ADD CONSTRAINT "absence_credits_period_consistent"
  CHECK ("period_start" < "period_end");

ALTER TABLE "billing_runs"
  ADD CONSTRAINT "billing_runs_period_consistent"
  CHECK ("period_start" < "period_end");

ALTER TABLE "billing_runs"
  ADD CONSTRAINT "billing_runs_due_day_of_month_range"
  CHECK ("due_day_of_month" IS NULL OR ("due_day_of_month" >= 1 AND "due_day_of_month" <= 28));

ALTER TABLE "billing_runs"
  ADD CONSTRAINT "billing_runs_total_amount_nonnegative"
  CHECK ("total_amount" >= 0);