# گزارش Rehearsal و پیاده‌سازی M-2 — یکپارچگی Tenant/Resident

تاریخ: 2026-11-07 — وضعیت: **پیاده‌سازی + Rehearsal روی دیتابیس‌های ایزوله** (هیچ تغییری روی `eskan_dev`، Staging یا Production انجام نشده).

## ۱. محدودهٔ انجام‌شده

مجوز مرحلهٔ اول M-2 (پیاده‌سازی و Rehearsal) اعمال شد. موارد زیر **تکمیل** شده‌اند:

### 1.1 Prisma Schema (`prisma/schema.prisma`)
- ۱۲ کلید UNIQUE tenant/resident-scoped افزوده شد:
  - `(organization_id, id)` روی hostels, rooms, beds, residents, stay_contracts, charges, payments, accommodation_packages.
  - `(organization_id, resident_id, id)` روی stay_contracts, charges, payments, temporary_absences.
- `PaymentAllocation` با `organizationId` + `residentId` (NOT NULL) و دو ارتباط composite به Payment (Cascade) و Charge (Restrict) به‌روزرسانی شد.

### 1.2 Migration (`prisma/migrations/20261107120000_m2_tenant_resident_composite_integrity`)
- **Preflight قبل از هر DDL:** شمارش cross-org/cross-resident/cross-hostel و ناسازگاری PaymentAllocation؛ در صورت ناسازگاری، کل migration بدون mutate متوقف می‌شود (احرازشده در تست Rollback).
- **۱۲ کلید UNIQUE** ساخته شد.
- **PaymentAllocation:** ستون‌های nullable → backfill از Payment → NOT NULL → swap دو FK به composite (حفظ onDelete: Cascade/Restrict).
- **۱۷ composite FK** tenant/resident-scoped (افزایشی؛ FKهای تک‌ستونه و سیاست onDelete موجود حفظ شدند).
- **۲ تریگر** برای قاعدهٔ Package خاص-Hostel:
  - `stay_contracts_package_hostel_check`: اگر package مخصوص hostel است، قرارداد باید در همان hostel باشد.
  - `accommodation_packages_hostel_change_check`: جلوگیری از تغییر hostel یک package زیر قراردادهای ناسازگار.

### 1.3 LockService (`src/common/concurrency/lock.service.ts`)
- `lockForUpdate(tx, entity, id, organizationId)` با **organizationId اجباری** و `WHERE id=$1 AND organization_id=$2 FOR UPDATE`.
- `lockGlobal(tx, entity, id)` برای موجودیت‌های global (organization/user/refresh_session).
- تمام Call Siteها (assignments, contracts, hostels, packages, rooms, beds, residents) با organizationId به‌روزرسانی شدند. `lockOrganization` به `lockGlobal` منتقل شد.

### 1.4 تست‌ها
- `scripts/test-m2-migration.cjs` (جدید): ۴ سناریو، **۴۱/۴۱** چک.
- `src/common/concurrency/lock.service.spec.ts` (جدید): ۶ تست واحد Tenant-scoped.
- `test/integration/lock-tenant-isolation.integration-spec.ts` (جدید): ۳ تست ایزوله‌سازی واقعی.
- `test-m1-migration.cjs` و `test-m2-preflight-detection.cjs` برای مستثنی‌کردن M-2 از baseline تنظیم شدند.
- `preflight-m2.cjs`: اصلاح `compositeReadiness` (strings→split) تا کلیدهای موجود را PRESENT گزارش کند.

## ۲. نتیجهٔ Rehearsal

### ۲.۱ Clone آزمایشی (از Snapshot دست‌نخورده)
- Clone جدید `eskan_m2_rehearsal_20261107` از `eskan_preflight_clone_20261107` (Snapshot شواهد، دست‌نخورده) ساخته شد و M-2 روی آن اعمال و سپس حذف شد.
- **قبل از migration:** orgs=72, contracts=90, packages=19, payment_allocations=0.
- **M-2 اعمال شد** → کلیدهای UNIQUE موجود، composite FKها موجود، تریگرها موجود.
- **Preflight بعد از migration (`--strict`):** `cross_org=0، cross_resident=0، cross_hostel=0، orphan=0` و **کلیدهای composite ۱۲/۱۲ PRESENT**.
- Clone اصلی `eskan_preflight_clone_20261107` پس از Rehearsal **دست‌نخورده** ماند (orgs=72, contracts=90, packages=19).

### ۲.۲ نتایج Gate

| Gate | خروجی | نتیجه |
|------|-------|-------|
| M2-A | Prisma Schema + Migration | ✅ تکمیل |
| M2-B | اجرا روی دیتابیس خالی | ✅ (۱۲ کلید + FK + تریگر) |
| M2-C | اجرا روی Clone دارای داده | ✅ (backfill + حفظ onDelete) |
| M2-D | رد Cross-Org/Cross-Resident با FK واقعی | ✅ (23503) |
| M2-E | تست Package/Hostel consistency | ✅ (23514 تریگر) |
| M2-F | تست LockService و Tenant isolation | ✅ (۶ unit + ۳ integration) |
| M2-G | Rollback / شکست migration | ✅ (preflight fail → بدون partial schema) |
| M2-H | CI | (پس از push تأیید نهایی می‌شود) |

تست منفی واقعی PostgreSQL (رد درج ناسازگار با کد خطا):
- اتاق cross-org → `23503`؛ تخصیص cross-resident → `23503`؛ صورتحساب cross-org → `23503`؛ package cross-org → `23503`؛ تخصیص پرداخت cross-resident → `23503`؛ **Package/Hostel mismatch → `23514`** (تریگر).

## ۳. تصمیم فنی مهم: قاعدهٔ Package خاص-Hostel

`(organization_id, id)` به‌تنهایی شرط «اگر `package.hostelId != NULL` آنگاه `contract.hostelId == package.hostelId`» را enforce نمی‌کند (چون این شرط بین دو ستون از دو جدول است و FK مرکب نمی‌تواند آن را بیان کند، مخصوصاً که packageهای سراسری hostelId=NULL دارند). بنابراین از **تریگر BEFORE روی `stay_contracts`** استفاده شد؛ این یک راهکار دیتابیسی است و با تست مستقل (`23514`) تأیید شده است.

## ۴. موارد ممنوع (اجرا نشده)

- هیچ Migration روی `eskan_dev`، Staging یا Production اعمال نشد.
- PR #1 باز و Merge نشده؛ `main` دست‌نخورده.
- M-3 و سرویس‌ها/کنترلرهای مالی شروع نشدند.
- `eskan_dev` بدون تغییر ماند (فقط Cloneها بررسی شدند).