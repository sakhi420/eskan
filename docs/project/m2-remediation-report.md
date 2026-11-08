# گزارش Remediation نهایی M-2 — Parity / Concurrency / Index

تاریخ: 2026-11-08 — مبنا: commit `6632bcf` — وضعیت: اصلاح سه نقص بازبینی مستقل (بدون تغییر `eskan_dev`/Staging/Production، بدون Merge).

## خلاصهٔ تصمیم فنی

بازبینی مستقل سه نقص را شناسایی کرد: (۱) عدم هماهنگی Prisma Schema با migration، (۲) race در تریگر Package/Hostel، (۳) نبود index فرزند برای composite FKها. راهکار اتخاذشده:

### ۱. Parity — مدل‌سازی composite FK در Prisma (به‌جای SQL-only additive)
- همهٔ ۱۹ composite FK حالا در `schema.prisma` مدل شده‌اند.
- برای روابط **nullable** (package/contract/creditCharge/expense.hostel/package.hostel)، Prisma به‌تنهایی نمی‌تواند «FK تک‌ستونهٔ SET‌NULL + FK مرکب scope» را بیان کند؛ پس دو رابطه مدل شدند:
  - رابطهٔ optional با `onDelete: SetNull` → FK تک‌ستونهٔ `SET NULL` (حفظ رفتار حذف ستون منفرد).
  - رابطهٔ named tenant با `onDelete: NoAction` → FK مرکب scope.
- PostgreSQL فقط با چنین ترکیبی می‌تواند هم scope و هم `SET NULL` روی ستون واحد را بدون null کردن `organization_id` (که NOT NULL است) حفظ کند: FK تک‌ستونه ستون را null می‌کند و FK مرکب (MATCH SIMPLE) چون یک ستون NULL است رد می‌شود. این رفتار با تست onDelete واقعی اثبات شد.
- FKهای تک‌ستونهٔ روابط NOT‌NULL حذف و با composite جایگزین شدند؛ نام قیدها و `ON UPDATE CASCADE` عیناً با خروجی `prisma migrate diff` هم‌خوان است.

**اثبات:** `scripts/test-m2-prisma-parity.cjs` → `prisma migrate diff` روی دیتابیس M-2 **خالی** است (5/5).

### ۲. Concurrency — `SELECT ... FOR UPDATE` در تریگر قرارداد
- `enforce_stay_contract_package_hostel` حالا package را با `FOR UPDATE` می‌خواند؛ تغییر `hostel_id` بسته (که قفل ردیف همان package را می‌گیرد) و insert/update قرارداد روی یک ردیف serialize می‌شوند.
- **اثبات:** `scripts/test-m2-package-hostel-concurrency.cjs` با دو اتصال واقعی، هر دو ترتیب (Update←Insert و Insert←Update) → یک عملیات block و با `23514` رد می‌شود (4/4).

### ۳. Index فرزند
- ۱۰ index فرزند composite ساخته شد (نام‌ها با Prisma هم‌خوان). افزونهٔ تکراری ایجاد نشد (indexهای موجود با ستون اول سازگار بازبینی و نگه داشته شدند).

## نتایج تست‌ها

| Test | نتیجه |
|---|---|
| `test-m2-migration.cjs` (empty/data/neg/preflight/onDelete/pkg-change) | **92/92** |
| `test-m2-package-hostel-concurrency.cjs` | **4/4** |
| `test-m2-prisma-parity.cjs` | **5/5** |
| `prisma validate` | سبز |
| `prisma migrate diff` (M-2 DB → schema) | **خالی** (بدون drift) |
| `npm run build` | سبز |

## شمارش اشیای دیتابیس M-2
- UNIQUE keys: ۱۲
- Composite FK: ۱۹ (multi-column)
- FK تک‌ستونهٔ SET NULL حفظ‌شده: ۵
- FK تک‌ستونهٔ قدیمی حذف‌شده: ۱۴
- Child FK indexes: ۱۰
- Triggers: ۲ (با FOR UPDATE در تریگر قرارداد)

## موارد تکمیلی
- **PaymentAllocation `@@unique([paymentId, chargeId])` حذف شد** (مطابق phase-9-engineering-plan.md F-19)؛ این قید دیگر به فاز مالی منتقل نمی‌شود و تخصیص مجدد پس از release را ممکن می‌سازد.
- **onDelete واقعی** (SET NULL / CASCADE / RESTRICT) روی PostgreSQL آزموده شد.

## محدودیت‌های رعایت‌شده
- `eskan_dev`، Staging و Production دست‌نخورده؛ Clone اصلی و Snapshot دست‌نخورده.
- فقط دیتابیس‌های throwaway (`eskan_m2_*`) استفاده شدند.
- PR Merge نشد؛ M-3 شروع نشد.