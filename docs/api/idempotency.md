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

## رفتار replay برای payment

بدنهٔ پاسخ replay همان Payment اصلی (با allocationها) است؛ پاسخ مبهم که
client را مجبور به retry کور کند داده نمی‌شود.