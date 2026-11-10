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
- **payment create idempotency record** فقط یک reference غیرحساس (`resourceType` + `resourceId`)
  ذخیره می‌کند؛ دادهٔ حساس پرداخت‌کننده (`payerName`/`payerPhone`/`payerRelation`/`notes`)
  هرگز در `idempotency_records.response_body` کپی دائمی نمی‌شود و replay پاسخ را از منبع اصلی
  (`payments`) بازسازی می‌کند.
- **replay (same key + same payload)** → 200/201 با همان نتیجهٔ قبلی.
- **same key + different payload** → 409 `IDEMPOTENCY_KEY_REUSED`.
- **concurrent request (same key هم‌زمان)** → یکی commit و بقیه همان نتیجه را می‌گیرند
  (store-then-execute داخل همان transaction).
- **retry پس از timeout+commit** → بازیابی همان نتیجه، نه اجرای مجدد.
- **retention دائمی مالی (پیاده‌شده در 4c/M3a):** `IdempotencyRecord.retentionClass`
  (`TRANSIENT | PERMANENT`) با migrationهای 4c پیاده شده است. رکورد `PERMANENT` با
  `expiresAt = NULL` ذخیره می‌شود و در `getReplay` هرگز lazy-delete نمی‌شود (retry چندماههٔ
  مالی به همان سند اشاره می‌کند). رکوردهای `TRANSIENT` پس از `expiresAt` (۳۰ روز) lazily منقضی می‌شوند.
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
  "semanticHeaders": { "x-expected-version": 4 },
  "body": { }
}
```

### سریال‌سازی قطعی (RFC 8785 / JCS)

- **الگوریتم:** JCS — کلیدهای هر object الفبایی (UTF-16 code unit)، خروجی compact بدون whitespace، بدون فاصلهٔ تزئینی، escape حداقلی JSON.
- **whitespace:** در خروجی canonical هیچ فاصله/خط جدیدی نیست.
- **string escaping:** فقط `"`، `\` و کاراکترهای کنترلی (< U+0020) escape می‌شوند؛ نویسه‌های غیر-ASCII (فارسی/دری) escape نمی‌شوند و مستقیماً UTF-8 می‌شوند.
- **numbers:** serialization دقیقاً مطابق RFC 8785 (الگوریتم ECMAScript `Number::toString`)؛ بدون گردکردن سفارشی. ورودی عددی canonical فقط **safe integer** مجاز است؛ اعداد اعشاری، `NaN`، `Infinity` و خارج از range دقیق binary64 رد می‌شوند؛ عدد صحیح بزرگ‌تر از `Number.MAX_SAFE_INTEGER` باید به‌صورت **JSON string** منتقل شود (مبلغ AFN همیشه integer و داخل safe range است).
- **encoding:** خروجی canonical UTF-8 است؛ SHA-256 روی بایت‌ها؛ خروجی hex lowercase.

### قواعد فیلدها

- **method:** uppercase.
- **route:** route template (نه URL واقعی)؛ با جایگاه پارامترها.
- **pathParams:** فقط پارامترهای موجود در route؛ object با کلید = نام پارامتر (کلیدها توسط JCS الفبایی می‌شوند)؛ مقادیر رشته.
- **query:** object با کلید = نام پارامتر، مقدار = آرایهٔ رشته‌ها (پس از **percent-decode دقیقاً یک‌بار**، UTF-8؛ `+` کاراکتر تحت‌اللفظی است و به space تبدیل نمی‌شود؛ `%20` = space). `?k` (بدون `=`) و `?k=` **معادل** هستند: هر دو `[""]`. مقادیر چندتایی فقط وقتی الفبایی مرتب می‌شوند که آن پارامتر طبق قرارداد ترتیب‌ناپذیر تعریف شده باشد؛ پارامتر scalar که چندبار تکرار شود **رد** می‌شود (422)، نه مرتب‌سازی پنهانی.
- **semanticHeaders:** فقط headerهای معنایی که روی نتیجه اثر دارند؛ فعلاً `x-expected-version` (عدد integer، تبدیل‌شده از مقدار header و سپس canonicalize). در ساختار **همیشه حاضر** است؛ خالی = `{}`. `Idempotency-Key`/`Authorization`/`User-Agent`/timestamp و `X-Organization-Id` وارد نمی‌شوند (scope سازمانی Idempotency از قبل سازمان را دربر دارد).
- **body:** همان بدنهٔ ارسالی با JCS — کلیدهای object بازگشتی الفبایی؛ ترتیب آرایه‌ها **حفظ** می‌شود؛ `null` صریح ≠ فیلد حذف‌شده ≠ مقدار پیش‌فرض.
- **Unicode/normalization:** هیچ‌گونه NFC/NFKC/case-fold اعمال نمی‌شود؛ code pointها عیناً هش می‌شوند؛ **lone surrogate** (UTF-16 ناقص) رد می‌شود. کلاینت‌ها موظف‌اند ورودی را پیش از ارسال به شکل یکسان (NFC) بفرستند.

### test vectors (canonical → SHA-256)

```
T1 :: {"body":{"amount":1500,"currency":"AFN","note":null},"method":"POST","pathParams":{},"query":{},"route":"/api/v1/payments","semanticHeaders":{}}
  -> 8aba91621d58acba92472ecfc84ad0b2d082b5396053749eba894caf8d943107

T2 :: body کلیدهای با ترتیب متفاوت، canonical/hash یکسان
  A {"note":"x","phone":"0700123456"}  و  B {"phone":"0700123456","note":"x"}
  -> {"body":{"note":"x","phone":"0700123456"},"method":"PATCH","pathParams":{"residentId":"11111111-1111-1111-1111-111111111111"},"query":{},"route":"/api/v1/residents/{residentId}","semanticHeaders":{}}
  -> a1a196b94fccee24d41c2d0ec29bd7a84351da396562fd1365c32f2fda38ca86

T3 :: null ≠ فیلد حذف‌شده (hash متفاوت)
  a) {} -> {"body":{},"method":"PATCH","pathParams":{"chargeId":"22222222-2222-2222-2222-222222222222"},"query":{},"route":"/api/v1/charges/{chargeId}","semanticHeaders":{}}
     -> 11ba0dd560b2773ec5d0cb3836a0fb6bc9336941a54c4bc35a239ca868557d6f
  b) {"note":null} -> {"body":{"note":null},"method":"PATCH","pathParams":{"chargeId":"22222222-2222-2222-2222-222222222222"},"query":{},"route":"/api/v1/charges/{chargeId}","semanticHeaders":{}}
     -> 0ac803f497e38ff941cde664493381dc63ac0be69a7899cc8e99302ebfbb7e0a

T4 :: query چندمقداری مرتب + بدون‌مقدار/خالی معادل
  a) ?tag=b&tag=a&tag=b -> {"body":{},"method":"GET","pathParams":{},"query":{"tag":["a","b","b"]},"route":"/api/v1/charges","semanticHeaders":{}}
     -> f4afe42487ebbcf9507afea5309bae0168aa2b0e0365fa9d7b8a60223ecf93ca
  b) ?tag  یا  ?tag= -> {"body":{},"method":"GET","pathParams":{},"query":{"tag":[""]},"route":"/api/v1/charges","semanticHeaders":{}}
     -> 3a1720385e7e769e931ffc5c89a8a4a162d1e659189b3d85fe758be9d9ce1a7f

T5 :: Unicode + عدد افغانی
  {"title":"کرایه موتر","amount":750}
  -> {"body":{"amount":750,"title":"کرایه موتر"},"method":"POST","pathParams":{},"query":{},"route":"/api/v1/expenses","semanticHeaders":{}}
  -> 28f9fd4521f61d640eac3fc200f28abc0adc9937fbb66bc2443f5662d930f1d9

T6 :: X-Expected-Version در fingerprint (body/key یکسان، version متفاوت → hash متفاوت)
  a) v=4 -> {"body":{"note":"x"},"method":"PATCH","pathParams":{"residentId":"33333333-3333-3333-3333-333333333333"},"query":{},"route":"/api/v1/residents/{residentId}","semanticHeaders":{"x-expected-version":4}}
     -> 26ce9c64b385790e11b30d6b2122ab7fc25cf303d4257ed1e3da332c8cc67aef
  b) v=5 -> {"body":{"note":"x"},"method":"PATCH","pathParams":{"residentId":"33333333-3333-3333-3333-333333333333"},"query":{},"route":"/api/v1/residents/{residentId}","semanticHeaders":{"x-expected-version":5}}
     -> eccb2a34e5a35406676da4579e018f0756d6c05daa996addb8fa6aeab41b03d7
```

same key + same hash = replay همان نتیجه؛ same key + different hash = 409 `IDEMPOTENCY_KEY_REUSED`.

## وضعیت پیاده‌سازی نسبت به قرارداد (هدف vs فعلی)

> این بخش برای جلوگیری از گزارش «هدف آینده» به‌عنوان «قابلیت پیاده‌سازی‌شده» است.

1. **JCS شش‌فیلدی (`canonicalRequestHash`):** در `src/common/idempotency/jcs.ts` پیاده و با `jcs.spec.ts` تست شده. مسیرهای مالی M3a (`POST /charges`، `POST /billing-runs`، `POST /absences/{id}/credits`) از آن استفاده می‌کنند.
2. **مسیرهای قدیمی (gap شناخته‌شده):** `IdempotencyService.hash()` همچنان مبتنی بر `stableStringify(payload)` است و `method`/`route`/`pathParams`/`query`/`semanticHeaders` را نمی‌پوشاند. **ادعای JCS کامل و سراسری بدون اثبات ممنوع است**؛ هم‌گرایی مابقی endpointها به JCS کار مرحلهٔ پیاده‌سازی است، نه وضعیت فعلی.
3. **retention دائمی:** `retentionClass` (`TRANSIENT|PERMANENT`) با migrationهای 4c پیاده شده؛ مسیر مالی `PERMANENT` است (بدون انقضای lazy) — وضعیت فعلی، نه طرح آینده.
4. `authRegister` در Controller، وجود و UUID بودن `Idempotency-Key` را اعتبارسنجی می‌کند اما مقدار را به `AuthService.register` منتقل نمی‌کند؛ بازیابی/تکرار ثبت‌نام فعلی بر پایهٔ email + رمز است، نه تطبیق key + fingerprint. idempotency ثبت‌نام باید جداگانه طراحی و تست شود (ثبت‌نام پیش از organization و scope فعلی organization-based است).
5. authorization پیش از replay: replay فقط پس از بررسی دوبارهٔ عضویت/مجوز کاربر فعلی برمی‌گردد (کلید در سطح Organization + Endpoint یکتاست، نه User).