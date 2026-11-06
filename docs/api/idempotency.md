# Idempotency — ESKAN

## قواعد

- همهٔ mutationها هدر `Idempotency-Key` می‌پذیرند (UUID v4).
- عملیات مالی (payment) هدر را اجباری می‌کند.
- key + canonical request hash ذخیره می‌شود (جدول `idempotency_records` با
  unique constraint روی `(organizationId, idempotencyKey, endpoint)`). یعنی
  scope کلید در سطح «سازمان + endpoint» است، نه در سطح کاربر؛ یک کلید در یک
  endpoint برای همهٔ کاربران همان سازمان یکتا است.
- اولین درخواست: نتیجه + key در همان transaction با عملیات ذخیره می‌شود.
- replay (same key + same request) → همان logical result.
- same key + different request → HTTP 409 `IDEMPOTENCY_KEY_REUSED`.
- پس از timeout+commit، client با همان key نتیجهٔ قبلی را بازیابی می‌کند.
- retention idempotency مالی با سیاست صریح؛ حذف زمان‌دار ساده ممنوع.
- رکوردهای غیرمالی پس از `expiresAt` به‌صورت **lazy** نامعتبر می‌شوند: یعنی فقط
  وقتی همان key دوباره درخواست شود، رکورد منقضی‌شده حذف و key قابل استفادهٔ مجدد
  می‌شود. این به‌معنای پاک‌سازی فیزیکی دوره‌ای (batch) نیست؛ پاک‌سازی فیزیکی
  انبوه رکوردهای منقضی‌شده به سیاست retention فاز مالی واگذار می‌شود.

## رفتار replay (financial mutation)

- **payment create** replay → همان `Payment` اصلی (ایجادشده به‌صورت **وجه تخصیص‌نیافته**) را
  برمی‌گرداند؛ Allocation بعداً با endpoint مستقل انجام می‌شود و در پاسخ create نیست.
- **replay (same key + same payload)** → 200/201 با همان نتیجهٔ قبلی.
- **same key + different payload** → 409 `IDEMPOTENCY_KEY_REUSED`.
- **concurrent request (same key هم‌زمان)** → یکی commit و بقیه همان نتیجه را می‌گیرند
  (store-then-execute داخل همان transaction).
- **retry پس از timeout+commit** → بازیابی همان نتیجه، نه اجرای مجدد.
- **retention دائمی مالی (طرح هدف آینده):** برای mutationهای مالی، `IdempotencyRecord`
  باید `retentionClass = PERMANENT` و `expiresAt = NULL` داشته باشد و هرگز lazy-delete نشود
  تا retry چندماهه هم به همان سند اشاره کند. **این هنوز در Prisma/سرویس فعلی پیاده نشده**
  (فعلاً `expiresAt` غیر nullable و بدون `retentionClass` است)؛ به‌عنوان نیازمندی Migration
  آینده ثبت می‌شود، نه وضعیت فعلی سیستم.
- **authorization قبل از replay:** نتیجهٔ replay فقط پس از بررسی دوبارهٔ عضویت/مجوز کاربرِ
  فعلی برمی‌گردد. کلید در سطح Organization + Endpoint یکتاست (نه User)، پس replay نباید راه
  دورزدن RBAC باشد. canonical request hash (fingerprint) برای تشخیص same-key-different-payload
  ذخیره می‌شود.