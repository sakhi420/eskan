# گزارش اجرای Migration مالی M3c روی دیتابیس توسعهٔ محلی `eskan_dev`

**Status:** PASS
**شناسه مأموریت:** ESKAN-M3C-DEV-MIGRATION-EXECUTION-v1.0
**تاریخ اجرا:** 2026-11-13

---

## Git

- **Branch:** `main`
- **SHA:** `9c4c561d01de23717934c1d863f450937ef2886d`
- **Working tree:** clean پیش از commit گزارش
- **PR #5:** ادغام‌شده (merge commit `4da7415f78278bb504d91c9ac0f1c3c91b6c1c35`؛ owner-directed)

## محیط

- **Node:** v24.21.0 (مطابق `engines >=24.0.0`)
- **npm:** 11.19.0
- **Prisma CLI:** 7.10.1 (schema-engine `d1b3f377ca835d73fd50954a5e22128b9ebdd6b8`)
- **PostgreSQL:** 17.6 on x86_64-windows

## Target DB (غیرمحرمانه)

- **database:** `eskan_dev`
- **host:** `127.0.0.1:5432` (محلی)
- **role:** `postgres`

## Backup (Gate D)

- **مسیر:** `C:\eskan_backups\eskan_dev_20261113_161147.dump` (خارج از مخزن)
- **حجم:** `276,522` bytes
- **فرمت:** `pg_dump --format=custom` (gzip)
- **archive validation:** `pg_restore --list` → exit 0؛ 305 آیتم / 309 TOC entry؛ فایل غیرخالی
- **SHA-256:** `435A82C75D21E84F38750790FA39E4E34AB6B1358AB4D575DCCBB6F524E4B4F6`

## Restore rehearsal (Gate E)

- **Clone:** `eskan_m3c_rehearsal_20261113_161444`
- **روش:** `CREATE DATABASE` با `TEMPLATE template0 ENCODING 'UTF8'` و locale مطابق منبع؛ سپس `pg_restore --exit-on-error`.
- **نتیجه:** restore exit 0؛ identity کلون (نه `eskan_dev`)؛ `_prisma_migrations` = ۱۸ ردیف؛ شمارش کلیدی مطابق منبع (orgs=72، residents=84، contracts=90، financial=0).
- **Migration روی Clone:** هر دو M3c با `prisma migrate deploy` موفق؛ `migrate status` → up to date؛ pg_catalog: 33 composite FK، CHECK‌های `payments_dapp_has_no_receipt`/`expenses_payment_method_not_dapp`، ستون `source_deposit_transaction_id`، `payment_id`/`allocation_id` NOT NULL.

## Legacy preflight (Gate C)

- رویدادهای قدیمی `REFUNDED`/`FORFEITED` بدون Source Link: **۰** ردیف → مسیر عادی (fail-fast فعال نشد).
- شمارش پایه: `deposit_transactions`/`expenses`/`payments`/`charges` همه **۰**.

## Migrations اعمال‌شده روی `eskan_dev` (Gate G)

| Migration | زمان اعمال (finished_at) | نتیجه |
|---|---|---|
| `20261112000000_m3c_deposit_refund_expense_reversal` | 2026-11-13 16:41:14.113868+04:30 | finished / no rollback / no failure log |
| `20261112120000_m3c_dapp_reversal_and_deposit_source` | 2026-11-13 16:41:15.350334+04:30 | finished / no rollback / no failure log |

- **روش:** `npx prisma migrate deploy` (نه `migrate dev`).

## نتایج فرمان‌ها و تست‌ها

| Gate / فرمان | نتیجه |
|---|---|
| `npm ci` | exit 0 (749 pkg, 8m; audit 29 finding: 4 Low/25 Moderate) |
| `npx prisma validate` | exit 0 |
| `npx prisma generate` | exit 0 |
| `npm run build` | exit 0 |
| `npm run openapi:validate` | exit 0 (۶ هشدار از پیش موجود) |
| `prisma migrate status` (قبل) | 19 found؛ فقط دو M3c pending؛ بدون drift |
| `node scripts/test-m3c-migration.cjs` | **99/99 PASS** |
| `node scripts/test-m2-prisma-parity.cjs` | **7/7 PASS** |
| `npm run test:e2e` | **4 suites / 29 tests PASS** |
| `npm run test:integration` | **13 suites / 139 tests PASS** |
| `prisma migrate status` (بعد) | **Database schema is up to date!** (exit 0) |
| `npx prisma validate` (بعد) | valid |

## Reconciliation شمارش (قبل/بعد)

- `_prisma_migrations`: **۱۸ → ۲۰** (فقط دو ردیف migration M3c جدید).
- بدون تغییر: organizations 72 · residents 84 · stay_contracts 90 · hostels 53 · users 72 · beds 91 · rooms 43 · bed_assignments 72 · packages 19 · components 57 · memberships 81 · subscriptions 72 · subscription_events 72 · plans 3 · refresh_sessions 94 · idempotency_records 427.
- مالی (بدون تغییر): charges/payments/expenses/deposit_transactions/payment_allocations/allocation_releases/absence_credits/billing_runs/receipt_counters/manual_subscription_payments/audit_events/sync_changes = **۰**.
- جداول جدید M3c (خالی): `deposit_applications`=0 · `ledger_reversals`=0 · `payment_refunds`=0.

## Environment boundary

- `eskan_dev` = **Applied**
- Staging = **Not Applied**
- Production = **Not Applied**

## محدودیت‌ها / ریسک‌های باز

- Backup در حالت سکون بدون رمزنگاری سطح OS ذخیره شده (BitLocker روی این ماشین dev تنظیم نشده)؛ دادهٔ dev/test است.
- ۲۹ هشدار وابستگی (۴ Low / ۲۵ Moderate) triage شده ولی رفع‌نشده — خارج از محدودهٔ این مأموریت.
- بازبینی مستقل نفر دوم برای SQL مالی M3c هنوز در GitHub ثبت نشده (ادغام owner-directed، نه تأیید مستقل).
- Clone `eskan_m3c_rehearsal_20261113_161444` برای شواهد حفظ شده؛ حذف آن پس از ثبت نهایی بر عهدهٔ مالک است.

## Next gate

**M3d — Account / Statement / Audit Read / Sync Pull**