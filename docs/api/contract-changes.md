---

# تصمیمات نهایی مالک — 2026-10-25 (حاکم بر قرارداد)

1. **مدل پول = A-016 (عدد صحیح افغانی):** تصمیم نهایی حفظ عدد صحیح AFN است؛ یادداشت
   قبلی «بازگشت به string ده‌دهی» باطل شد. `Money.amount` و مبالغ خلاصهٔ گزارش‌ها
   `integer` هستند؛ از FLOAT/DOUBLE استفاده نمی‌شود؛ گردکردن با قاعدهٔ half-up انجام و
   نتیجه به عدد صحیح AFN ذخیره می‌شود. (تصمیم A-016 بر اصل ۱۰ مسترپرامپت v3.0 مقدم است.)
2. **حذف `POST /api/v1/sync/operations`:** نوشتنی‌های آفلاین از همان endpointهای mutation
   اصلی + `Idempotency-Key` replay می‌شوند؛ endpoint/مدل‌های دسته‌ای حذف شدند.
3. **سقف‌های پایلوت (seed، نه hard-code):** FREE = ۱ لیلیه/۳۰ ساکن/۲ کاربر؛
   PRO = ۳/۳۰۰/۱۰؛ BUSINESS = قابل تنظیم (`null` = نامحدود صریح).
   `priceAmount` nullable و `null ≠ صفر` (قیمت تعیین‌نشده برای PRO/BUSINESS).

---

# بازبینی Gate 1 (phase-9 financial) — هم‌ترازی امنیت قرارداد با ماتریس

## تغییرات امنیتی (بدون تغییر migration/Prisma)

1. `POST /api/v1/invitations/accept` → `security: []` (پذیرش با توکن یک‌بارمصرف؛ دعوت‌شونده لزومی به ورود قبلی ندارد).
2. این ۵ عملیات هویتی → `security: [{ bearerAuth: [] }]` (احراز هویت الزامی ولی بدون `X-Organization-Id`؛ از endpointهای anonymous جدا شدند):
   - `GET /api/v1/system/me` · `GET /api/v1/auth/me` · `POST /api/v1/auth/logout` · `POST /api/v1/auth/logout-all` · `POST /api/v1/auth/change-password`
3. ماتریس مجوزها به ۵ کلاس صریح بازنویسی شد: Anonymous / احراز بدون نقش سازمانی / عضو سازمانی (هر نقش) / محدود نقش / Platform Admin — نگاه کنید به `permissions-matrix.md`.
4. `GET /api/v1/organizations` → `security: [{ bearerAuth: [] }]` (فهرست عضویت‌ها/سازمان‌ها برای انتخاب سازمان فعال، بدون `X-Organization-Id`).
5. هر ۱۰ عملیات `/api/v1/admin/**` → `security: [{ bearerAuth: [] }]` (بدون `X-Organization-Id`؛ مجوز سیستمی از `User.isPlatformAdmin` سمت سرور؛ `organizationId` مسیر = سازمان هدف).
6. canonical hash به ساختار ۶فیلدی گسترش یافت (`semanticHeaders` شامل `X-Expected-Version`) و test vectorها بازمحاسبه شدند (T1–T6 با SHA-256 واقعی) — نگاه کنید به `idempotency.md`.
# بازبینی v0.3.0 — تطبیق با مسترپرامپت v3.0 (اشتراک/کنترل + مدل پول)

## تغییرات

1. **مدل پول به string ده‌دهی برگشت** (همراستا با اصل ۱۰ و بخش C.3 مسترپرامپت v3.0):
   `Money.amount` و مبالغ خلاصهٔ گزارش‌ها از `integer` به `string` (الگوی
   `^\d+(\.\d{1,2})?$`) تغییر کرد. این بازگشت تصمیم A-016 (عدد صحیح افغانی) است.

   > ⚠️ **تاریخی — باطل‌شده:** این بازگشت بعداً در «تصمیمات نهایی مالک 2026-10-25» (بالا) لغو شد و **A-016 (عدد صحیح افغانی)** مدل حاکم است؛ این بخش فقط سابقهٔ بازبینی است.
2. **حوزهٔ اشتراک/Trial/Entitlements** اضافه شد (طرح‌ها، وضعیت‌ها، history، پرداخت دستی).
3. **APIهای Platform Admin** زیر `/api/v1/admin/**` اضافه شد (فعال‌سازی/تمدید/تغییر/تعلیق/
   ازسرگیری/grace/پرداخت).
4. کد خطای `PLAN_LIMIT_EXCEEDED` به `ErrorCode` افزوده شد.
5. `info.version` → `0.3.0`.

## نتیجهٔ اعتبارسنجی (فرمان واقعی)

```
npx @redocly/cli@1.25.15 lint contracts/openapi.yaml   # exit=0 → valid
npx js-yaml contracts/openapi.yaml                        # exit=0
```

- خطا: **۰** — هشدار: **۶** (غیرمسدودکننده): ۴× `operation-4xx-response` (سلامت/نسخه/plans
  عمومی)، ۱× `info-license-strict`، ۱× `no-server-example.com`.
- مقیاس: ۷۵ مسیر، ۹۱ عملیات.
---

# بازبینی v0.2.0 — اعمال تصمیم‌های قطعی مالک محصول (2026-10-25)

## تغییرات

1. **Money مشترک (صحیح‌افغانی):** ساختار `Money { amount: integer, currency: "AFN" }`
   افزوده و در همهٔ مدل‌های مالی درخواست/پاسخ (`StayContract.rent/deposit`,
   `Charge`, `Payment`, `PaymentAllocation`, `DepositTransaction`, `Expense`)
   به‌جای `amount`+`currency` پراکنده استفاده شد. مبالغ گزارش‌ها به `integer` تبدیل شد.
2. **چندسازمانی:** `AuthSession` اکنون `memberships` (آرایهٔ `MembershipSummary`)
   برمی‌گرداند؛ endpoint `GET /api/v1/organizations` برای فهرست اعضویت‌ها افزوده شد.
3. **دعوت عضو:** افزودن مستقیم عضو حذف و جریان دعوت با توکن یک‌بارمصرف جایگزین شد:
   `POST /organizations/current/members/invitations` (ایجاد، token خام فقط یک‌بار)،
   `GET .../invitations` (فهرست)، `POST .../invitations/{id}/revoke` (ابطال)،
   `POST /invitations/accept` (پذیرش با token). مدل‌های `Invitation`,
   `InvitationRequest`, `InvitationCreated`, `InvitationAcceptRequest` افزوده شد.
4. **پاسخ‌های خطا:** componentهای مشترک `Forbidden`, `NotFound`, `Conflict`,
   `ValidationError`, `RateLimited` افزوده و از طریق `$ref` به endpointها (401/403/404/
   409/422 و 429 برای ورود) متصل شدند.
5. `info.version` به `0.2.0` ارتقا یافت.

## نتیجهٔ اعتبارسنجی نهایی (فرمان واقعی)

```
npx @redocly/cli@1.25.15 lint contracts/openapi.yaml   # exit=0 → valid
```

- خطا (error): **۰**
- هشدار (warning): **۵** — همگی غیرمسدودکننده و مستند:
  - `operation-4xx-response` ×۳: فقط `health/live`, `health/ready`,
    `system/version` (عمومی؛ 4xx معنادار ندارند).
  - `info-license-strict` ×۱: license اختصاصی بدون SPDX identifier.
  - `no-server-example.com` ×۱: URL نمونهٔ example.com ندارد.

`js-yaml` (تجزیهٔ YAML) نیز با `exit=0` موفق بود.

## یادداشت

- توکن دعوت فقط به‌صورت هش در DB ذخیره می‌شود و خام آن فقط یک‌بار در پاسخ create
  برگردانده می‌شود (جزئیات در پیاده‌سازی enforce می‌شود).
- گردکردن proration با decimal.js انجام می‌شود؛ مبلغ ذخیره‌شده integer است.
# تغییرات قرارداد OpenAPI — بازبینی و اصلاح

تاریخ: 2026-10-25
وضعیت اعتبارسنجی: **VALID** (Redocly `lint` با `exit=0`؛ خطای ساختاری صفر).

## ۱. اصلاح ساختار YAML (اولویت صفر)

- هم‌ترازی pathها زیر `paths` و `responses`/`schemas` زیر `components` تصحیح شد.
- ۴ کلید schema که بیرون از `schemas` افتاده بودند (`RegisterRequest`, `Role`,
  `StayContract`, `ResidentAccount`) به تراز صحیح برگردانده شدند.
- نتیجه: فایل خام YAML از «خطای تجزیه» به حالت معتبر رسید.

## ۲. همگام‌سازی آفلاین — ارسال عملیات از موبایل به سرور

- endpoint جدید: `POST /api/v1/sync/operations`.
- schemaهای جدید: `SyncOperation`, `SyncOperationsRequest`,
  `SyncOperationResult`, `SyncOperationsResponse`.
- هر عملیات: `operationId` (uuid)، `entityType`، `action`
  (`CREATE|UPDATE|ARCHIVE|REVERSE`)، `payload`، `baseVersion`، `idempotencyKey`.
- نتیجهٔ هر عملیات: `status` از `SyncOperationStatus`
  (`APPLIED|DUPLICATE|CONFLICT|VALIDATION_FAILED|FORBIDDEN|RETRYABLE_FAILURE`).
  `SyncOperationStatus` که پیش‌تر تعریف‌شده ولی استفاده‌نشده بود، اکنون مصرف شد.

## ۳. صفحه‌بندی type-safe

- `Page` عمومی با `items: {}` حذف شد؛ به‌جای آن ۸ schema صفحهٔ نوع‌دار ساخته شد:
  `HostelPage`, `RoomPage`, `BedPage`, `ResidentPage`, `ContractPage`,
  `ChargePage`, `PaymentPage`, `ExpensePage`.
- هر endpoint فهرست اکنون نوع دقیق items را برمی‌گرداند (قابل تولید برای Flutter).

## ۴. یکدست‌سازی Idempotency-Key

- در همهٔ mutationهای حساس (پرداخت، ودیعه، مصرف، کرایه، تخصیص بستر، ایجاد
  ساکن/قرارداد و register) `Idempotency-Key` اجباری شد.
- به endpointهای reversal (charge/payment/deposit/expense) پارامتر
  `Idempotency-Key` اضافه شد.
- سیاست: same key + same payload = replay همان result؛ same key + payload
  متفاوت = 409 `IDEMPOTENCY_KEY_REUSED` (در `docs/api/idempotency.md`).

## ۵. یکدست‌سازی وضعیت اسناد مالی

- enum مشترک `LedgerEntryStatus` (`POSTED|REVERSED`) ساخته شد.
- وضعیت `Charge`, `Payment`, `DepositTransaction`, `Expense` همگی به
  `LedgerEntryStatus` ارجاع داده شدند (به‌جای `ChargeStatus` نامتناسب).

## ۶. شفاف‌سازی سازمان و عضویت

- endpoint جدید: `POST /api/v1/organizations/current/members` (افزودن عضو توسط
  OWNER) با `MemberInviteRequest`.
- `X-Organization-Id` همچنان فقط selector است؛ authority سمت سرور (مستند).

## ۷. قرارداد نسخهٔ رکورد

- هدر `If-Match` (که معنای استاندارد ETag دارد) به `X-Expected-Version`
  (integer) تغییر یافت تا ابهام نداشته باشد؛ semantic آن به‌صورت صریح:
  نسخهٔ مورد انتظار؛ mismatch → 409 `RESOURCE_VERSION_CONFLICT`.

## ۸. بهبودهای کوچک

- `info.license` افزوده شد.
- توضیح (description) برای همهٔ tagها افزوده شد.
- schemaهای مردهٔ `Page` و `Money` حذف شدند.

## تغییراتی که عمداً انجام نشد / باقی‌مانده

- 56 warning از قاعدهٔ `operation-4xx-response` (برشمردن 4xx برای هر عملیات).
  دلیل: مدل خطا متمرکز در `docs/api/error-model.md` است و در پیاده‌سازی،
  global exception filter به‌صورت یکسان Problem Details برمی‌گرداند؛
  contract tests رعایت status codeها را تضمین می‌کنند. این قاعده non-blocking
  (recommended) است و فایل معتبر باقی می‌ماند.
- 2 warning جزئی: `info-license-strict` (عدم `identifier` برند) و
  `no-server-example.com`.