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

fingerprint = SHA-256 روی ساختار کانونیکالِ صریح (JSON با فیلدهای جداگانه) که با **RFC 8785 / JCS (JSON Canonicalization Scheme)** سریالایز می‌شود:

```json
{
  "method": "POST",
  "route": "/api/v1/residents/{residentId}/payments",
  "pathParams": { "residentId": "<uuid>" },
  "query": { "key": ["v1", "v2"] },
  "body": { }
}
```

### سریال‌سازی قطعی (RFC 8785 / JCS)

- **الگوریتم:** JCS — کلیدهای هر object الفبایی (UTF-16 code unit)، خروجی compact بدون whitespace، بدون فاصلهٔ تزئینی، escape حداقلی JSON.
- **whitespace:** در خروجی canonical هیچ فاصله/خط جدیدی نیست.
- **string escaping:** فقط `"`، `\` و کاراکترهای کنترلی (< U+0020) escape می‌شوند؛ نویسه‌های غیر-ASCII (فارسی/دری) escape نمی‌شوند و مستقیماً UTF-8 می‌شوند.
- **numbers:** فرم I-JSON (RFC 7493) — عدد صحیح/اعشاری، بدون نمایش علمی، بدون `NaN`/`Infinity`، بدون صفرهای پیشرو (پول افغانی همیشه عدد صحیح = افغانی).
- **encoding:** خروجی canonical UTF-8 است؛ SHA-256 روی بایت‌ها؛ خروجی hex lowercase.

### قواعد فیلدها

- **method:** uppercase.
- **route:** route template (نه URL واقعی)؛ با جایگاه پارامترها.
- **pathParams:** فقط پارامترهای موجود در route؛ object با کلید = نام پارامتر (کلیدها توسط JCS الفبایی می‌شوند)؛ مقادیر رشته.
- **query:** object با کلید = نام پارامتر، مقدار = آرایهٔ رشته‌ها. ترتیب آرایهٔ چندمقداری از نظر معنایی بی‌اهمیت است؛ اجزای هر آرایه الفبایی (UTF-16 code unit) مرتب می‌شوند. `?k` (بدون `=`) و `?k=` **معادل** هستند: هر دو `[""]` (رشتهٔ خالی).
- **body:** همان بدنهٔ ارسالی با JCS — کلیدهای object بازگشتی الفبایی؛ ترتیب آرایه‌ها **حفظ** می‌شود؛ `null` صریح ≠ فیلد حذف‌شده ≠ مقدار پیش‌فرض.
- **Unicode/normalization:** هیچ‌گونه NFC/NFKC/case-fold اعمال نمی‌شود؛ code pointها عیناً هش می‌شوند. کلاینت‌ها موظف‌اند ورودی را پیش از ارسال به شکل یکسان (NFC) بفرستند.
- **حذف از hash:** `Idempotency-Key` و headerهای ناپایدار (`Authorization`, `User-Agent`, timestamp و…) وارد ساختار نمی‌شوند.

### test vectors (canonical → SHA-256)

```
T1 :: {"body":{"amount":1500,"currency":"AFN","note":null},"method":"POST","pathParams":{},"query":{},"route":"/api/v1/payments"}
  -> 78448fda558b23d5da49d48f128e7dfaf4ff1221a0da6b7c1b3be4fdc3d6d630

T2 :: body کلیدهای با ترتیب متفاوت، canonical/hash یکسان
  A {"note":"x","phone":"0700123456"}  و  B {"phone":"0700123456","note":"x"}
  -> {"body":{"note":"x","phone":"0700123456"},"method":"PATCH","pathParams":{"residentId":"11111111-1111-1111-1111-111111111111"},"query":{},"route":"/api/v1/residents/{residentId}"}
  -> d7e09a35b59d76a05d1a5b3ae8e729a50d4dd850646ad7eb6c6a696a1dad8065

T3 :: null ≠ فیلد حذف‌شده (hash متفاوت)
  a) {} -> {"body":{},"method":"PATCH","pathParams":{"chargeId":"22222222-2222-2222-2222-222222222222"},"query":{},"route":"/api/v1/charges/{chargeId}"}
     -> 876fd0589481392b9b883f4df949d7e0717620f323d2afba39175361dc65f526
  b) {"note":null} -> {"body":{"note":null},...same...}
     -> 945dd944490f28ce4898eb2695e20448d5699d223bd177c3d1449bc2cf7b2eee

T4 :: query چندمقداری مرتب + بدون‌مقدار/خالی معادل
  a) ?tag=b&tag=a&tag=b -> {"body":{},"method":"GET","pathParams":{},"query":{"tag":["a","b","b"]},"route":"/api/v1/charges"}
     -> 4a126fe77c6d43aaab097360cff9ca87cea2102359b6a64709514bc95a4cec95
  b) ?tag  یا  ?tag= -> {"tag":[""]}
     -> d245c1c1dc88a6d54fb48993600a4ab5d075f3a490e944591d83c4279d342872

T5 :: Unicode + عدد افغانی
  {"title":"کرایه موتر","amount":750}
  -> {"body":{"amount":750,"title":"کرایه موتر"},"method":"POST","pathParams":{},"query":{},"route":"/api/v1/expenses"}
  -> 64b2b4af343b734bbcf0cc5da2e5bf314e9c750ab47435c5cdad3e88d04a6362
```

same key + same hash = replay همان نتیجه؛ same key + different hash = 409 `IDEMPOTENCY_KEY_REUSED`.