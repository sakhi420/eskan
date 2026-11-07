# گزارش پیش‌بررسی M-2 روی Clone واقعی دیتابیس توسعه

تاریخ: 2026-11-07 — وضعیت: **Read-only** (`BEGIN TRANSACTION READ ONLY`، فقط `SELECT`).

## مشخصات Clone
- نام: `eskan_preflight_clone_20261107`
- منبع: دیتابیس توسعهٔ محلی `eskan_dev` (PostgreSQL روی `127.0.0.1:5432`)
- زمان ساخت: `2026-11-07T16:34:38Z` (UTC)
- روش: `CREATE DATABASE ... TEMPLATE eskan_dev` (در لحظهٔ clone هیچ اتصال فعالی به منبع نبود)
- ایزوله: بدون اتصال برنامه/worker؛ فقط اتصال preflight به clone.

## ترکیب دادهٔ منبع (eskan_dev) در لحظهٔ clone
| جدول | تعداد |
|---|---|
| organizations | 72 |
| hostels | 53 |
| rooms | 43 |
| beds | 91 |
| residents | 84 |
| stay_contracts | 90 |
| bed_assignments | 72 |
| users | 72 |
| accommodation_packages | 19 |
| accommodation_package_components | 57 |
| stay_contracts دارای package_id | 7 |
| charges / payments / payment_allocations / deposit_transactions / expenses / temporary_absences | 0 (خالی) |

## نتیجهٔ Preflight (`node scripts/preflight-m2.cjs --strict`)
```text
cross_org_mismatches:        0
cross_resident_mismatches:   0
cross_hostel_mismatches:     0
orphan_rows:                 0
missing required UNIQUE keys: 12/12
```
(پوشش: ۱۸ cross-org، ۵ cross-resident، ۱ cross-hostel، ۱۸ orphan — همگی count=0 روی دادهٔ واقعی.)

## تفسیر
1. دادهٔ موجود در لایهٔ اقامت (rooms/beds/contracts/assignments) **هیچ ناسازگاری cross-organization یا cross-resident ندارد**.
2. جدول‌های مالی و `temporary_absences` خالی‌اند؛ صفرِ آنها یعنی «داده‌ای برای نقض وجود ندارد»، نه اینکه آن مسیرها با دادهٔ واقعی آزموده شده‌اند.
3. `orphan=0` — FKهای فعلی مانع orphan شده‌اند.
4. `12/12 MISSING` فقط وضعیت schema (نبودِ کلیدهای composite) را نشان می‌دهد؛ **خطای داده نیست**.

## نتیجه‌گیری برای تصمیم Migration
- برای **دادهٔ موجود** هیچ backfill/اصلاح لازم نیست.
- افزودن composite-FK و کلیدهای UNIQUE **بدون نیاز به پاک‌سازی داده** ممکن است.
- چون مسیر مالی/absence خالی است، پس از واردشدن دادهٔ مالی واقعی، توصیه می‌شود preflight دوباره (به‌ویژه روی PaymentAllocation و Absence→Charge) اجرا شود.

## نکتهٔ اتصال و محدودیت‌ها
- preflight با حساب `postgres` ولی داخل `BEGIN TRANSACTION READ ONLY` اجرا شد (هیچ write در تراکنش ممکن نیست). برای آینده نقش `SELECT`-only جداگانه پیشنهاد می‌شود.
- آزمون destructive (`test-m2-preflight-detection.cjs`) روی این clone **اجرا نشد** (طبق دستور، فقط `preflight-m2.cjs --strict`).
- Clone برای بازبینی/بازاجرا نگه‌داشته شده و قابل حذف است.