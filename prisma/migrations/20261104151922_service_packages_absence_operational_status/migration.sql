-- CreateEnum
CREATE TYPE "PackageComponentKind" AS ENUM ('ACCOMMODATION', 'BOARD', 'SERVICE');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPERATIONAL', 'NEEDS_CLEANING', 'NEEDS_REPAIR', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'ADJUSTED', 'CLOSED');

-- AlterEnum
ALTER TYPE "ChargeType" ADD VALUE 'ADJUSTMENT';

-- AlterTable
ALTER TABLE "beds" ADD COLUMN     "maintenance_status" "MaintenanceStatus" NOT NULL DEFAULT 'OPERATIONAL';

-- AlterTable
ALTER TABLE "hostels" ADD COLUMN     "absence_min_days" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "default_rent_amount" INTEGER,
ADD COLUMN     "rent_due_day_of_month" INTEGER;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "payer_name" TEXT,
ADD COLUMN     "payer_phone" TEXT,
ADD COLUMN     "payer_relation" TEXT;

-- AlterTable
ALTER TABLE "residents" ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT,
ADD COLUMN     "emergency_contact_relation" TEXT;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "maintenance_status" "MaintenanceStatus" NOT NULL DEFAULT 'OPERATIONAL';

-- AlterTable
ALTER TABLE "stay_contracts" ADD COLUMN     "package_id" UUID,
ADD COLUMN     "package_snapshot" JSONB;

-- CreateTable
CREATE TABLE "accommodation_packages" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "hostel_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accommodation_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accommodation_package_components" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "kind" "PackageComponentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "deductible_on_absence" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "accommodation_package_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_absences" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "status" "AbsenceStatus" NOT NULL DEFAULT 'REQUESTED',
    "planned_departure_date" DATE NOT NULL,
    "actual_departure_date" DATE,
    "expected_return_date" DATE NOT NULL,
    "actual_return_date" DATE,
    "reason" TEXT,
    "notes" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "credit_charge_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "temporary_absences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accommodation_packages_organization_id_idx" ON "accommodation_packages"("organization_id");

-- CreateIndex
CREATE INDEX "accommodation_packages_organization_id_hostel_id_idx" ON "accommodation_packages"("organization_id", "hostel_id");

-- CreateIndex
CREATE INDEX "accommodation_package_components_package_id_idx" ON "accommodation_package_components"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "temporary_absences_credit_charge_id_key" ON "temporary_absences"("credit_charge_id");

-- CreateIndex
CREATE INDEX "temporary_absences_organization_id_resident_id_idx" ON "temporary_absences"("organization_id", "resident_id");

-- CreateIndex
CREATE INDEX "temporary_absences_organization_id_contract_id_idx" ON "temporary_absences"("organization_id", "contract_id");

-- CreateIndex
CREATE INDEX "temporary_absences_organization_id_status_idx" ON "temporary_absences"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "accommodation_packages" ADD CONSTRAINT "accommodation_packages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accommodation_packages" ADD CONSTRAINT "accommodation_packages_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accommodation_package_components" ADD CONSTRAINT "accommodation_package_components_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "accommodation_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "stay_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_absences" ADD CONSTRAINT "temporary_absences_credit_charge_id_fkey" FOREIGN KEY ("credit_charge_id") REFERENCES "charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_contracts" ADD CONSTRAINT "stay_contracts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "accommodation_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
