# گزارش پیش‌بررسی M-2 (فقط‌خواندنی) — پوشش کامل

تاریخ: 2026-11-07 — وضعیت: **Read-only Preflight (تشخیصی)** — هیچ تغییری در data/schema انجام نشد.
نسخه: پس از تکمیل پوشش (TemporaryAbsence + کلیدهای سه‌ستونی + تشخیص دقیق UNIQUE).

## روش و ایمنی
- ابزار: `scripts/preflight-m2.cjs`
- **guard fail-closed:** فقط نام‌های دیتابیس آزمایشی روی host محلی مجاز است؛ در غیر این صورت `REFUSED` (override صریح: `PREFLIGHT_ALLOW=1`).
- کل ممیزی داخل `BEGIN TRANSACTION READ ONLY` و فقط `SELECT`.
- اجرای demo روی دیتابیس throwaway (`eskan_m2_preflight_demo_*`) حاوی **دادهٔ پاک + ناسازگاری‌های عمدی (شامل TemporaryAbsence)**، که پس از اتمام حذف شد.

## خروجی واقعی (demo روی دیتابیس موقتی — نه دیتابیس واقعی اسکان)
```text
## Cross-organization mismatches (child.org != parent.org)
- Room  -> Hostel              (org must match)    count=1
- Bed   -> Room                (org must match)    count=0
- Contract -> Hostel        (org must match)       count=1
- Contract -> Resident      (org must match)       count=1
- Assignment -> Bed         (org must match)       count=0
- Assignment -> Resident   (org must match)        count=1
- Assignment -> Contract   (org must match)        count=0
- Charge -> Resident        (org must match)       count=1
- Charge -> Contract        (org must match)       count=0
- Payment -> Resident       (org must match)       count=0
- Deposit -> Resident       (org must match)       count=0
- Expense -> Hostel          (org must match)      count=0
- Allocation: payment.org vs charge.org            count=0
- Absence -> Contract       (org must match)       count=1
- Absence -> Resident      (org must match)        count=2
total: 8

## Cross-resident mismatches
- Assignment: resident vs its contract resident    count=1
- Charge: resident vs its contract resident        count=0
- Allocation: payment.resident vs charge.resident  count=1
- Absence: resident vs its contract resident       count=1
total: 3

## Orphans / missing parents (FK-enforced, expect 0)
... (16 checks, incl. Absence) total: 0

## Composite-key readiness (required UNIQUE keys for tenant-scoped composite FKs)
- hostels            (organization_id, id) MISSING
- rooms              (organization_id, id) MISSING
- beds               (organization_id, id) MISSING
- residents          (organization_id, id) MISSING
- stay_contracts     (organization_id, id) MISSING
- stay_contracts     (organization_id, resident_id, id) MISSING
- charges            (organization_id, id) MISSING
- charges            (organization_id, resident_id, id) MISSING
- payments           (organization_id, id) MISSING
- payments           (organization_id, resident_id, id) MISSING
- temporary_absences (organization_id, id) MISSING
- temporary_absences (organization_id, resident_id, id) MISSING

## Summary
cross_org_mismatches:        8
cross_resident_mismatches:   3
orphan_rows:                 0
missing required UNIQUE keys: 12/12
```

## یافته‌های کلیدی
1. **Cross-organization (۸):** FKهای فعلی فقط وجودِ رکورد والد را بررسی می‌کنند، نه تطبیق `organization_id`. preflight همهٔ مواردِ عمدی را در `rooms`, `stay_contracts` (hostel/resident), `bed_assignments` (resident), `charges` (resident) و `temporary_absences` (contract/resident) شناسایی کرد.
2. **Cross-resident (۳):** در `bed_assignments`، `payment_allocations` و `temporary_absences` (resident ≠ residentِ قرارداد) قابل ورود است.
3. **Orphan: صفر** — FKهای موجود مانع orphan می‌شوند.
4. **Composite-key readiness:** ۱۲ کلید موردنیاز (۱۲/۱۲) همگی MISSING هستند — شامل کلیدهای سه‌ستونی `(organization_id, resident_id, id)` برای `stay_contracts/charges/payments/temporary_absences` که برای تحمیل هم‌زمان سازمان+ساکن در PaymentAllocation و روابط مشابه لازم‌اند. تشخیص UNIQUE دقیق است: تطبیق مجموعهٔ ستون‌ها با همان ترتیب؛ یک UNIQUE سه‌ستونی به‌اشتباه کلید دوستونی را تأمین نمی‌کند.
5. **PaymentAllocation:** جدول فاقد `organization_id`/`resident_id` است؛ organization و resident باید از طریق Payment و Charge تطبیق شوند؛ برای composite-FK از نوع `(organization_id, resident_id, payment_id) → payments(organization_id, resident_id, id)` والد باید UNIQUE سه‌ستونی داشته باشد.

## تفکیک مهم: demo در برابر clone واقعی
اعداد بالا (۸/۳/۰) نتیجهٔ یک **آزمایش تشخیصی روی دادهٔ مصنوعی** است و **وضعیت دیتابیس واقعی اسکان نیست**. قبل از طراحی و اجرای migration، همین ابزار باید روی یک **clone معتبر و فقط‌خواندنی از دیتابیس مبنای توسعه** اجرا شود تا تعداد واقعی ناسازگاری‌ها مشخص شود.

## پیشنهاد ترتیب migration آینده (بدون اجرا — نیازمند مجوز جداگانه)
1. افزودن `UNIQUE(organization_id, id)` روی والدهای ساده: `hostels`, `rooms`, `beds`, `residents`.
2. افزودن `UNIQUE(organization_id, id)` **و** `UNIQUE(organization_id, resident_id, id)` روی: `stay_contracts`, `charges`, `payments`, `temporary_absences`.
3. سپس composite-FK tenant/resident-scoped روی روابط (Room→Hostel, Bed→Room, Contract→Hostel/Resident, Assignment→Bed/Resident/Contract, Charge→Resident/Contract, Payment→Resident, Deposit→Resident, Expense→Hostel, Absence→Resident/Contract).
4. برای `PaymentAllocation`: تصمیم دربارهٔ افزودن `organization_id` (و `resident_id`) + اعتبارسنجی تطبیق با Payment/Charge، و composite-FK دوگانهٔ `→ Payment` و `→ Charge`.

## محدودیت‌های رعایت‌شده
- هیچ `ALTER`/`CREATE`/`DROP`/migration، `UPDATE`/backfill، FK/index/constraint، تغییر `PaymentAllocation`/`LockService`، کد production یا OpenAPI انجام نشد.
- preflight فقط روی clone/دیتابیس آزمایشی throwaway اجرا شد؛ نه روی دیتابیس عملیاتی.
- M-3 و سرویس‌ها/کنترلرهای مالی شروع نشد.