# گزارش پیش‌بررسی M-2 (فقط‌خواندنی)

تاریخ: 2026-11-07 — وضعیت: **Read-only Preflight (تشخیصی)** — هیچ تغییری در data/schema انجام نشد.

## روش و ایمنی
- ابزار: `scripts/preflight-m2.cjs`
- **guard fail-closed:** فقط نام‌های دیتابیس آزمایشی روی host محلی مجاز است؛ در غیر این صورت `REFUSED` (override صریح: `PREFLIGHT_ALLOW=1`).
- کل ممیزی داخل `BEGIN TRANSACTION READ ONLY` اجرا و سپس `ROLLBACK` می‌شود — هیچ write ممکن نیست.
- فقط `SELECT`. اجرا روی یک دیتابیس throwaway (`eskan_m2_preflight_demo_*`) حاوی **دادهٔ پاک + ناسازگاری‌های عمدی**، که پس از اتمام حذف شد.

## خروجی واقعی (نمونه روی دیتابیس موقتی)
```text
# M-2 READ-ONLY PREFLIGHT — relationship inventory & integrity
database:    eskan_m2_preflight_demo_mw6jh73d
transaction: READ ONLY (BEGIN TRANSACTION READ ONLY; ROLLBACK)

## Cross-organization mismatches (child.org != parent.org)
- Room  -> Hostel              (org must match)    count=1  sample=["da27fc03-f528-4d02-90ee-a26274f68867"]
- Bed   -> Room                (org must match)    count=0
- Contract -> Hostel        (org must match)       count=1  sample=["e9786de5-a36b-4268-9077-7b53411e7bd9"]
- Contract -> Resident      (org must match)       count=1  sample=["e9786de5-a36b-4268-9077-7b53411e7bd9"]
- Assignment -> Bed         (org must match)       count=0
- Assignment -> Resident   (org must match)        count=1  sample=["ae483cba-36bb-4b60-83e5-227e426c0d16"]
- Assignment -> Contract   (org must match)        count=0
- Charge -> Resident        (org must match)       count=1  sample=["746d1cea-bd12-4935-a540-92e10ac9cf9e"]
- Charge -> Contract        (org must match)       count=0
- Payment -> Resident       (org must match)       count=0
- Deposit -> Resident       (org must match)       count=0
- Expense -> Hostel          (org must match)      count=0
- Allocation: payment.org vs charge.org            count=0
total: 5

## Cross-resident mismatches
- Assignment: resident vs its contract resident    count=1  sample=["ae483cba-36bb-4b60-83e5-227e426c0d16"]
- Charge: resident vs its contract resident        count=0
- Allocation: payment.resident vs charge.resident  count=1  sample=["7370cead-b44e-4f34-8a89-e6232276ef53 / c554fa30-21cf-45a5-820a-59f868cad252"]
total: 2

## Orphans / missing parents (FK-enforced, expect 0)
... (13 checks) total: 0

## Composite-key readiness (parent needs UNIQUE(organization_id, id) for composite FKs)
- hostels          UNIQUE(org,id)? NO   hostels_pkey: PRIMARY KEY (id)
- rooms            UNIQUE(org,id)? NO   rooms_pkey: PRIMARY KEY (id)
- beds             UNIQUE(org,id)? NO   beds_pkey: PRIMARY KEY (id)
- residents        UNIQUE(org,id)? NO   residents_pkey: PRIMARY KEY (id)
- stay_contracts   UNIQUE(org,id)? NO   stay_contracts_pkey: PRIMARY KEY (id)

## Summary
cross_org_mismatches:        5
cross_resident_mismatches:   2
orphan_rows:                 0
parents missing UNIQUE(org,id): 5/5
```

## یافته‌های کلیدی
1. **Cross-organization:** FKهای فعلی فقط وجودِ رکورد والد را بررسی می‌کنند، نه تطبیق `organization_id`. بنابراین امکان ورود رکورد فرزند با `organization_id` متفاوت از والد وجود دارد. نمونهٔ مصنوعی ۵ مورد از این نوع را در جداول `rooms`, `stay_contracts` (hostel/resident), `bed_assignments` (resident) و `charges` (resident) نشان داد و preflight همه را شناسایی کرد.
2. **Cross-resident:** در `bed_assignments` (resident ≠ residentِ قرارداد) و `payment_allocations` (payment.resident ≠ charge.resident) قابل ورود است.
3. **یتیم/بدون والد:** صفر — چون FKهای موجود `ON DELETE` در عمل مانع orphan می‌شوند. (موردی یافت نشد.)
4. **Composite-key readiness:** هیچ‌یک از ۵ جدول والدِ لازم (`hostels`, `rooms`, `beds`, `residents`, `stay_contracts`) دارای `UNIQUE(organization_id, id)` نیستند. برای افزودن composite-FK (مثلاً `(organization_id, resident_id) → residents(organization_id, id)`) ابتدا باید این index یکتا روی والد ساخته شود.
5. **PaymentAllocation:** جدول فاقد `organization_id`/`resident_id` است و فقط `payment_id` + `charge_id` دارد؛ organization و resident باید از طریق `payments` و `charges` تطبیق داده شوند (دو check اختصاصی `allocation.org` و `allocation.resident` در خروجی).

## پیشنهاد ترتیب migration آینده (بدون اجرا — نیازمند مجوز جداگانه)
1. افزودن `UNIQUE(organization_id, id)` روی والدها: `hostels`, `rooms`, `beds`, `residents`, `stay_contracts`.
2. سپس افزودن composite-FK (organ/tenant-scoped) روی روابط یادشده (Room→Hostel, Bed→Room, Contract→Hostel/Resident, Assignment→Bed/Resident/Contract, Charge→Resident/Contract, Payment→Resident, Deposit→Resident, Expense→Hostel).
3. برای `PaymentAllocation`: تصمیم دربارهٔ افزودن `organization_id` (و `resident_id`) + اعتبارسنجی تطبیق با `Payment`/`Charge` پیش از هر composite-FK/backfill.

## محدودیت‌های رعایت‌شده
- هیچ `ALTER`/`CREATE`/`DROP`/migration، `UPDATE`/backfill، FK/index/constraint، تغییر `PaymentAllocation`/`LockService`، کد production یا OpenAPI انجام نشد.
- preflight فقط روی clone/دیتابیس آزمایشی throwaway اجرا شد؛ نه روی دیتابیس عملیاتی.
- M-3 و سرویس‌ها/کنترلرهای مالی شروع نشد.