/*
  Warnings:

  - The primary key for the `organizations` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `organizations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ArchiveStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BedStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ResidentType" AS ENUM ('STUDENT', 'WORKER', 'OTHER');

-- CreateEnum
CREATE TYPE "ResidentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'TERMINATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('RENT', 'UTILITY', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER');

-- CreateEnum
CREATE TYPE "DepositType" AS ENUM ('RECEIVED', 'REFUNDED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'GRACE_PERIOD', 'FREE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubscriptionAction" AS ENUM ('TRIAL_STARTED', 'TRIAL_ENDED', 'PLAN_ACTIVATED', 'PLAN_EXTENDED', 'PLAN_CHANGED', 'PLAN_DOWNGRADED', 'SUSPENDED', 'RESUMED', 'GRACE_GRANTED', 'PAYMENT_VERIFIED');

-- CreateEnum
CREATE TYPE "SyncAction" AS ENUM ('UPSERT', 'TOMBSTONE');

-- CreateEnum
CREATE TYPE "SyncPlatform" AS ENUM ('ANDROID', 'WINDOWS', 'OTHER');

-- AlterTable
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_pkey",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3),
ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "token_hash" TEXT NOT NULL,
    "inviter_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "replaced_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostels" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "notes" TEXT,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beds" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "notes" TEXT,
    "status" "BedStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "residents" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "type" "ResidentType" NOT NULL DEFAULT 'OTHER',
    "phone" TEXT,
    "notes" TEXT,
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "residents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stay_contracts" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "contract_number" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "rent_amount" INTEGER NOT NULL,
    "billing_cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "deposit_amount" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stay_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bed_assignments" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bed_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "contract_id" UUID,
    "type" "ChargeType" NOT NULL,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'POSTED',
    "amount" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "description" TEXT,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'POSTED',
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "received_at" DATE NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "notes" TEXT,
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_transactions" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "type" "DepositType" NOT NULL,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'POSTED',
    "amount" INTEGER NOT NULL,
    "received_at" DATE,
    "reason" TEXT,
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deposit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organization_id" UUID NOT NULL,
    "hostel_id" UUID,
    "category" TEXT NOT NULL,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'POSTED',
    "amount" INTEGER NOT NULL,
    "spent_at" DATE NOT NULL,
    "payment_method" "PaymentMethod",
    "description" TEXT,
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'AFN',
    "price_amount" INTEGER,
    "billing_cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "max_hostels" INTEGER,
    "max_rooms" INTEGER,
    "max_beds" INTEGER,
    "max_residents" INTEGER,
    "max_members" INTEGER,
    "max_devices" INTEGER,
    "advanced_reports" BOOLEAN NOT NULL DEFAULT false,
    "csv_export" BOOLEAN NOT NULL DEFAULT false,
    "detailed_finance" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trial_starts_at" TIMESTAMPTZ(3),
    "trial_ends_at" TIMESTAMPTZ(3),
    "period_starts_at" TIMESTAMPTZ(3),
    "period_ends_at" TIMESTAMPTZ(3),
    "grace_ends_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" "SubscriptionAction" NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_subscription_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "received_at" DATE NOT NULL,
    "verified_by_user_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "manual_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_devices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "platform" "SyncPlatform" NOT NULL,
    "app_version" TEXT,
    "last_cursor" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_changes" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" "SyncAction" NOT NULL,
    "entity_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_sync_state" (
    "organization_id" UUID NOT NULL,
    "current_cursor" INTEGER NOT NULL DEFAULT 0,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_sync_state_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_hash" TEXT,
    "status_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "trace_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "invitations_organization_id_status_idx" ON "invitations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_replaced_by_id_key" ON "refresh_sessions"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_family_idx" ON "refresh_sessions"("user_id", "family");

-- CreateIndex
CREATE INDEX "hostels_organization_id_idx" ON "hostels"("organization_id");

-- CreateIndex
CREATE INDEX "hostels_organization_id_status_idx" ON "hostels"("organization_id", "status");

-- CreateIndex
CREATE INDEX "rooms_organization_id_idx" ON "rooms"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_hostel_id_code_key" ON "rooms"("hostel_id", "code");

-- CreateIndex
CREATE INDEX "beds_organization_id_idx" ON "beds"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "beds_room_id_code_key" ON "beds"("room_id", "code");

-- CreateIndex
CREATE INDEX "residents_organization_id_idx" ON "residents"("organization_id");

-- CreateIndex
CREATE INDEX "residents_organization_id_full_name_idx" ON "residents"("organization_id", "full_name");

-- CreateIndex
CREATE INDEX "residents_organization_id_status_idx" ON "residents"("organization_id", "status");

-- CreateIndex
CREATE INDEX "stay_contracts_organization_id_resident_id_idx" ON "stay_contracts"("organization_id", "resident_id");

-- CreateIndex
CREATE INDEX "stay_contracts_organization_id_hostel_id_idx" ON "stay_contracts"("organization_id", "hostel_id");

-- CreateIndex
CREATE UNIQUE INDEX "stay_contracts_organization_id_contract_number_key" ON "stay_contracts"("organization_id", "contract_number");

-- CreateIndex
CREATE INDEX "bed_assignments_organization_id_bed_id_status_idx" ON "bed_assignments"("organization_id", "bed_id", "status");

-- CreateIndex
CREATE INDEX "bed_assignments_organization_id_resident_id_status_idx" ON "bed_assignments"("organization_id", "resident_id", "status");

-- CreateIndex
CREATE INDEX "bed_assignments_organization_id_contract_id_idx" ON "bed_assignments"("organization_id", "contract_id");

-- CreateIndex
CREATE INDEX "charges_organization_id_resident_id_status_idx" ON "charges"("organization_id", "resident_id", "status");

-- CreateIndex
CREATE INDEX "charges_organization_id_due_date_idx" ON "charges"("organization_id", "due_date");

-- CreateIndex
CREATE INDEX "charges_organization_id_contract_id_idx" ON "charges"("organization_id", "contract_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_resident_id_status_idx" ON "payments"("organization_id", "resident_id", "status");

-- CreateIndex
CREATE INDEX "payments_organization_id_received_at_idx" ON "payments"("organization_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_receipt_number_key" ON "payments"("organization_id", "receipt_number");

-- CreateIndex
CREATE INDEX "payment_allocations_charge_id_idx" ON "payment_allocations"("charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_charge_id_key" ON "payment_allocations"("payment_id", "charge_id");

-- CreateIndex
CREATE INDEX "deposit_transactions_organization_id_resident_id_idx" ON "deposit_transactions"("organization_id", "resident_id");

-- CreateIndex
CREATE INDEX "deposit_transactions_organization_id_type_idx" ON "deposit_transactions"("organization_id", "type");

-- CreateIndex
CREATE INDEX "expenses_organization_id_spent_at_idx" ON "expenses"("organization_id", "spent_at");

-- CreateIndex
CREATE INDEX "expenses_organization_id_category_idx" ON "expenses"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "organization_subscriptions_organization_id_key" ON "organization_subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "organization_subscriptions_plan_id_idx" ON "organization_subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "subscription_events_organization_id_created_at_idx" ON "subscription_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "manual_subscription_payments_organization_id_idx" ON "manual_subscription_payments"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_devices_organization_id_device_id_key" ON "sync_devices"("organization_id", "device_id");

-- CreateIndex
CREATE INDEX "sync_changes_organization_id_entity_type_entity_id_idx" ON "sync_changes"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_changes_organization_id_sequence_key" ON "sync_changes"("organization_id", "sequence");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organization_id_idempotency_key_endpoin_key" ON "idempotency_records"("organization_id", "idempotency_key", "endpoint");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_fkey" FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_contracts" ADD CONSTRAINT "stay_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_contracts" ADD CONSTRAINT "stay_contracts_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_contracts" ADD CONSTRAINT "stay_contracts_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "stay_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "stay_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_subscription_payments" ADD CONSTRAINT "manual_subscription_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_subscription_payments" ADD CONSTRAINT "manual_subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "organization_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_subscription_payments" ADD CONSTRAINT "manual_subscription_payments_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_sync_state" ADD CONSTRAINT "organization_sync_state_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable btree_gist for the range-exclusion (bed assignment overlap) constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- No two ACTIVE assignments may overlap in date range for the same bed
ALTER TABLE "bed_assignments"
  ADD CONSTRAINT "bed_assignments_no_overlap"
  EXCLUDE USING gist (
    "bed_id" WITH =,
    daterange("start_date", COALESCE("end_date", 'infinity'::date), '[]') WITH &&
  )
  WHERE ("status" = 'ACTIVE');
