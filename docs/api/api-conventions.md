# قراردادهای API — ESKAN

منبع حقیقت قرارداد: `contracts/openapi.yaml`.

## قواعد عمومی

1. همهٔ مسیرهای محصول زیر `/api/v1`؛ health زیر `/health`.
2. JSON UTF-8؛ نام propertyها `camelCase`؛ enumها uppercase.
3. شناسهٔ داخلی UUID؛ شمارهٔ سند/رسید string یکتا در محدودهٔ سازمان.
4. عملیات نوشتنی با هدر `Idempotency-Key` (UUID)؛ موجودیت mutable با `version`.
5. `GET` هیچ اثر مالی/جانبی ندارد.
6. pagination صریح: `page` (default 1)، `size` (default 20، max از قرارداد). پاسخ `Page`:
   `items, page, size, totalElements, totalPages`.
7. sort فقط از allow-list سرور؛ ورودی sort خام به DB نمی‌رود.

## پاکت پاسخ

موفق (تکی): `{ "data": {...}, "meta": { "traceId": "..." } }`
موفق (فهرست): `{ "data": {items,page,size,totalElements,totalPages}, "meta": {...} }`
خطا: Problem Details (RFC 9457) با `code` پایدار + `traceId`.

## مبلغ

مبلغ سند مالی عدد صحیح افغانی است (`Money { amount: integer, currency: "AFN" }` طبق A-016)؛ هرگز FLOAT/DOUBLE و هرگز مبلغ منفی (جهت با `entrySide` بیان می‌شود). مبالغ تجمیعی حساب/گزارش به‌صورت string عددی (تا ۱۹ رقم) منتقل می‌شوند.

## زمان

timestamp RFC 3339 UTC؛ تاریخ کاری `YYYY-MM-DD` جدا از timestamp.

## تغییرات و backwards compatibility

- افزودن فیلد optional: non-breaking.
- حذف/تغییر نوع فیلد یا تغییر enum: breaking → نسخهٔ API جدید.
- قرارداد در `contracts/openapi.yaml` قبل از endpointها تغییر می‌کند.

## نسخهٔ رکورد و قفل خوش‌بینانه (X-Expected-Version)

- موجودیت‌های mutable (contract, hostel, absence, resident, …) هنگام update هدر
  `X-Expected-Version` (integer) با `version` فعلی رکورد می‌فرستند.
- عملیات مالی append-only روی سند منبع (reversal/refund/release/apply/forfeit) هدر را
  **اختیاری** برای `version` سند منبع می‌پذیرند.
- mismatch → `409 RESOURCE_VERSION_CONFLICT` + `version` فعلی در پاسخ خطا؛ client باید
  re-read و retry کند (بدون Last-write-wins).