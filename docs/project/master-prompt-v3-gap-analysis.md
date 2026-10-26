# تطبیق مسترپرامپت v3.0 با قرارداد فعلی — گزارش اختلاف

- **تاریخ:** 2026-10-25
- **نتیجه اعتبارسنجی قرارداد پس از تطبیق:** `exit=0` (valid) — ۷۵ مسیر، ۹۱ عملیات، `info.version = 0.3.0`.

## ۱. آنچه از قبل پوشش داده شده بود (بدون تغییر حذفی)

بخش عملیاتی MVP در v3.0 تقریباً به‌طور کامل در قرارداد موجود بود:

- System (`/health/live`, `/health/ready`, `/system/version`, `/system/me`)
- Auth کامل (register/login/refresh/logout/logout-all/me/change-password)
- organizations (current + members + دعوت)
- hostels/rooms/beds (CRUD + archive/deactivate)
- residents (CRUD + timeline + account + archive)
- contracts + bed-assignments (activate/terminate/end)
- charges/payments/deposits/expenses (reverse برای همه)
- reports (dashboard/occupancy/receivables/financial-summary/expenses/statement)
- sync (devices/register, changes, status, resync-request) — به‌علاوه `POST /sync/operations`

## ۲. شکاف‌های شناسایی‌شده (و نحوهٔ رفع)

### ۲.۱ حوزهٔ اشتراک/Trial/Entitlements — کاملاً نبود (بزرگ‌ترین شکاف) ✅ اضافه شد

هیچ مدل یا مسیری برای اشتراک نرم‌افزار وجود نداشت. افزوده شد:

- **مدل‌ها:** `SubscriptionPlan`, `PlanLimits`, `PlanCode`, `PlanStatus`, `PlanBillingCycle`,
  `SubscriptionStatus`, `SubscriptionAction`, `OrganizationSubscription`, `SubscriptionUsage`,
  `SubscriptionCurrent`, `SubscriptionAuditEvent`, `SubscriptionHistoryPage`,
  `ManualSubscriptionPayment`, `AdminOrganizationSummary/Page` و درخواست‌های
  `AdminActivateRequest`, `AdminExtendRequest`, `AdminChangePlanRequest`, `AdminSuspendRequest`,
  `AdminResumeRequest`, `AdminGrantGraceRequest`, `AdminManualPaymentRequest`.
- **مسیرهای کاربر:** `GET /api/v1/plans`, `GET /api/v1/subscription/current`,
  `GET /api/v1/subscription/history`.
- **مسیرهای Platform Admin:** `GET /api/v1/admin/organizations`,
  `GET /api/v1/admin/organizations/{id}/subscription`,
  `GET .../subscription/history`,
  `POST .../subscription/{activate|extend|change-plan|suspend|resume|grant-grace}`،
  `POST .../subscription/payments`.
- **کد خطا:** `PLAN_LIMIT_EXCEEDED` به `ErrorCode` افزوده شد.

این پاسخ مستقیم به ۱۳ بند بخش ویژهٔ الزام‌آور v3.0 است (Trial ۳۰روزه، Free/PRO/BUSINESS،
entitlements قابل تنظیم، انقضا/grace، تمدید دستی و پرداخت تأییدشده، audit append-only،
جدایی کامل از مالیهٔ ساکنان).

### ۲.۲ مدل Money — مغایرت با v3.0 برطرف شد ✅

تصمیم قبلی مالک (A-016) «عدد صحیح افغانی» بود؛ v3.0 (اصل ۱۰ و بخش C.3) صریحاً
`NUMERIC(19,2)` + «string ده‌دهی» (مثل `"2000.00"`) را الزامی می‌کند. چون v3.0 مرجع
به‌روز است، قرارداد به string ده‌دهی برگردانده شد:

- `Money.amount` از `integer` به `string` با `pattern: '^\d+(\.\d{1,2})?$'` تغییر کرد.
- مبالغ خلاصهٔ گزارش‌ها (`totalCharged`, `totalOutstanding`, …) به `string` برگشت.
- گردکردن proration همچنان half-up به نزدیک‌ترین افغانی (با decimal.js) است.

**این مورد یک «بازگشت تصمیم» است و برای تأیید نهایی مالک گزارش می‌شود** (عدد صحیح
افغانی در DB با `NUMERIC(19,2)` که همیشه `.00` باشد قابل جمع است، ولی شکل API در v3.0
باید string باشد).

### ۲.۳ سایر نکات

- **Maintenance:** در v3.0 «در صورت شمول MVP» است (SHOULD)؛ به‌عمد ساخته نشد.
- **`POST /api/v1/sync/operations`:** v3.0 می‌گوید نوشتن آفلاین «از همان endpointهای
  mutation با Idempotency-Key» ارسال شود و از API عمومی برای تبدیل JSON دلخواه به entity
  پرهیز شود. endpoint فعلی typed است (نه JSON دلخواه)، ولی برای هم‌راستایی کامل با v3.0
  بازبینی نهایی لازم است (FLAG — به‌عنوان تصمیم باز ثبت می‌شود).
- **قیمت طرح‌ها:** مطابق v3.0 هیچ قیمت تجاری ساختگی درج نشد؛ `priceAmount` nullable است
  و مقادیر باید از seed/مدیریت طرح تأمین شوند.

## ۳. نتیجهٔ اعتبارسنجی نهایی (فرمان واقعی)

```
npx js-yaml contracts/openapi.yaml                       # exit=0
npx @redocly/cli@1.25.15 lint contracts/openapi.yaml     # exit=0 → valid
```

- **خطا: ۰** — **هشدار: ۶** (همگی غیرمسدودکننده):
  - `operation-4xx-response` ×۴: `health/live`, `health/ready`, `system/version`, `GET /plans`
    (عمومی؛ 4xx معنادار ندارند).
  - `info-license-strict` ×۱، `no-server-example.com` ×۱.

## ۴. تصمیم‌های باز برای مالک محصول (وضعیت نهایی 2026-10-25)

1. ~~بازگشت مدل پول~~ → **حفظ A-016 عدد صحیح افغانی** (تصمیم قطعی؛ بر اصل ۱۰ v3.0 مقدم).
2. ~~سرنوشت `POST /sync/operations`~~ → **حذف شد**؛ replay از همان mutation‌ها + Idempotency-Key.
3. سقف/قیمت: سقف‌های پایلوت FREE/PRO/BUSINESS ثبت شد (seed)؛ قیمت PRO/BUSINESS تا تصمیم
   تجاری تعیین نمی‌شود (`priceAmount` nullable، `null ≠ صفر`).