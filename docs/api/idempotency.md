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
  دورزدن RBAC باشد.

## استثناهای مستند (reasoned exceptions)

فقط این ۶ عملیات Idempotency-Key ندارند (۵ Auth + ۱ read-only):

1. `authLogin`
2. `authRefresh`
3. `authLogout`
4. `authLogoutAll`
5. `authChangePassword`
6. `billingRunPreview`

> `authRegister` هدر اجباری دارد و جزو استثناها نیست.

## canonical request hash

fingerprint = SHA-256 (خروجی hex lowercase) روی ساختار کانونیکالِ صریح با فیلدهای جداگانه (نه الحاق سادهٔ رشته‌ها):

```json
{
  "method": "POST",
  "route": "/api/v1/residents/{residentId}/payments",
  "pathParams": { "residentId": "<uuid>" },
  "query": { "key": ["v1", "v2"] },
  "body": { }
}
```

قواعد قطعی serialization:

- **encoding:** ساختار کانونیکال JSON است؛ با UTF-8 به بایت تبدیل و SHA-256 گرفته می‌شود؛ خروجی hex (lowercase).
- **method:** uppercase.
- **route:** route template (نه URL واقعی)؛ با جایگاه پارامترها.
- **pathParams:** فقط پارامترهایی که در route حضور دارند؛ کلیدها به ترتیب ظاهر در route، مقادیر رشته.
- **query:** کلیدها الفبایی؛ query تکراری/چندمقداری به آرایه تبدیل و اجزای هر آرایه الفبایی مرتب می‌شوند؛ کلید بدون مقدار (`k`) با `k=` و `k=v` متمایز است.
- **body:** canonical JSON — کلیدهای اشیا به‌صورت بازگشتی الفبایی؛ ترتیب آرایه‌ها حفظ می‌شود؛ `null` صریح ≠ فیلد حذف‌شده؛ هر دو ≠ مقدار پیش‌فرض.
- **حذف از hash:** `Idempotency-Key` و headerهای ناپایدار (`Authorization`, `User-Agent`, timestamp و…) وارد ساختار نمی‌شوند.

مثال‌های تستی:

- معادل (hash یکسان): `{"a":1,"b":2}` و `{"b":2,"a":1}` (کلید مرتب می‌شود).
- غیرمعادل (hash متفاوت): `{"a":1}` و `{"a":null}` (null صریح ≠ عدد)؛ `{}` و `{"a":null}` (فیلد حذف‌شده ≠ null صریح).

same key + same hash = replay همان نتیجه؛ same key + different hash = 409 `IDEMPOTENCY_KEY_REUSED`.