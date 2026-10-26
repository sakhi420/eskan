# Idempotency — ESKAN

## قواعد

- همهٔ mutationها هدر `Idempotency-Key` می‌پذیرند (UUID v4).
- عملیات مالی (payment) هدر را اجباری می‌کند.
- key + canonical request hash ذخیره می‌شود (جدول `idempotency_records` با
  unique constraint و scope سازمان/کاربر).
- اولین درخواست: نتیجه + key در همان transaction با عملیات ذخیره می‌شود.
- replay (same key + same request) → همان logical result.
- same key + different request → HTTP 409 `IDEMPOTENCY_KEY_REUSED`.
- پس از timeout+commit، client با همان key نتیجهٔ قبلی را بازیابی می‌کند.
- retention idempotency مالی با سیاست صریح؛ حذف زمان‌دار ساده ممنوع.

## رفتار replay برای payment

بدنهٔ پاسخ replay همان Payment اصلی (با allocationها) است؛ پاسخ مبهم که
client را مجبور به retry کور کند داده نمی‌شود.