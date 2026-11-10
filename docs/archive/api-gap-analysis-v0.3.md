> **سند تاریخی (آرشیو 2026-11-10) — برای اجرای فعلی پروژه مرجع نیست.** مرجع اجرایی فاز ۹: `ESKAN_PHASE9_EXECUTION_DIRECTIVE_v1_FA.md` · مرجع محصول: `docs/product/mvp-scope.md` · مرجع وضعیت: `docs/project/progress.md`.

# تحلیل شکاف API — نسخهٔ ۰.۳

- **تاریخ:** 2026-11-04
- **هدف:** مقایسهٔ سه منبع حقیقت — قرارداد `contracts/openapi.yaml` v0.3.0، `prisma/schema.prisma`، و کد Backend پیاده‌سازی‌شده — با نیازمندی‌های واقعی دامنه (پس از بازبینی).
- **نتیجه:** بدون تغییر قرارداد/schema؛ صرفاً گزارش شکاف برای تصمیم مالک.

## افسانهٔ وضعیت

| برچسب | معنا |
|---|---|
| EXISTING | کامل و مناسب |
| PARTIAL | موجود ولی ناقص |
| MISSING | وجود ندارد |
| NEEDS_REDESIGN | منطق/مدل فعلی نامناسب |
| FUTURE | فعلاً نیاز نیست |

## ۱. وضعیت پیاده‌سازی Backend نسبت به قرارداد

قرارداد v0.3.0 **سطح بیشتری از کد فعلی** دارد. ماژول‌های Backend که هم‌اکنون پیاده شده‌اند: `auth`، `organizations`، `hostels`، `rooms`، `beds` (به‌علاوهٔ `health`، `database`، `common`).

موارد **در قرارداد هست ولی کد Backend ندارد** (باید در فازهای بعد implements شوند):
`residents`، `contracts`، `bed-assignments`، `charges`، `payments`، `deposits`، `expenses`، `reports`، `sync`، `invitations`، `plans/subscription/admin-subscription`.

> وجود نام یک endpoint در OpenAPI معادل پیاده‌سازی کامل آن نیست.

## ۲. شکاف‌های دامنه (خلاصه)

| قابلیت | وضعیت در قرارداد | وضعیت در schema | وضعیت کد | برچسب |
|---|---|---|---|---|
| لیلیه/اتاق/تخت CRUD + archive | دارد | دارد | دارد | EXISTING |
| اطلاعات تماس/تنظیمات عملیاتی لیلیه | ندارد | ندارد | ندارد | MISSING |
| نوع/امکانات/ظرفیت اتاق | ندارد | ندارد | ندارد | MISSING |
| وضعیت نگهداری (آماده/تعمیر/خارج از سرویس) اتاق/تخت | ندارد | فقط BedStatus(ACTIVE/INACTIVE) | ندارد | NEEDS_REDESIGN |
| پروندهٔ ساکن پایه | دارد | دارد | ندارد | PARTIAL |
| تماس اضطراری ساکن | ندارد | ندارد | ندارد | MISSING |
| قرارداد اقامت (flat rent) | دارد | دارد | ندارد | EXISTING |
| بستهٔ اقامت (accommodation/board/services) | ندارد | ندارد | ندارد | MISSING |
| snapshot اجزای بسته در قرارداد | ندارد | ندارد | ندارد | MISSING |
| تخصیص/پایان تخصیص رخت با overlap | دارد | دارد (btree_gist) | ندارد | EXISTING |
| انتقال اتاق/تخت (move) | ندارد | ندارد (فقط end+create) | ندارد | MISSING |
| Check-out + تسویهٔ نهایی | PARTIAL (terminate) | PARTIAL | ندارد | PARTIAL |
| Charge/Payment/Deposit/Expense + reversal | دارد | دارد | ندارد | EXISTING |
| پرداخت‌کننده جدا از ساکن (Payer) | ندارد | ندارد | ندارد | MISSING |
| تخفیف | ندارد | ندارد | ندارد | MISSING |
| تولید انبوه idempotent کرایهٔ ماهانه | ندارد | ندارد | ندارد | MISSING |
| Credit/Adjustment برای غیابت | ندارد | ندارد (فقط reversal) | ندارد | MISSING |
| غیابت موقت (TemporaryAbsence) | ندارد | ندارد | ندارد | MISSING |
| درخواست تعمیر/نظافت | ندارد (در مسترپرامپت «در صورت شمول MVP») | ندارد | ندارد | MISSING |
| صندوق روزانه | PARTIAL (financial-summary) | ندارد | ندارد | PARTIAL |
| گزارش‌ها (dashboard/occupancy/receivables/…) | دارد | view/query | ندارد | EXISTING |
| sync (register/changes/status/resync) | دارد | دارد | ندارد | EXISTING |
| نقش‌ها | دارد | دارد | دارد | EXISTING |

## ۳. نکات کلیدی Contract vs Schema

- **پلتفرم دستگاه:** الان **ثابت است** — `SyncPlatform` در schema و `platform` در `SyncDeviceRegisterRequest` هر دو `[ANDROID, WINDOWS, OTHER]` هستند (در فاز ۷ اصلاح شد). نگرانی قبلی دربارهٔ `IOS` برطرف است. `SyncDevice.platform` در قرارداد نوعِ string عام است (باید در بازبینی بعدی enum شود — minor).
- **پول (Money):** قرارداد `Money { amount: integer, currency: AFN }` دارد و schema از `Int` استفاده می‌کند (سازگار با A-016). اما چند فیلد گزارش در قرارداد هنوز `string`/`integer` ناسازگار دارند (مثلاً `FinancialSummaryReport.totalReversedPayments` و `ExpenseReport.total` از نوع `string`؛ `Money.amount` از نوع `integer`) — نیازمند پاک‌سازی cosmetic در بازبینی بعدی (نه تغییر رفتاری).

## ۴. چه چیزهایی «قبل از فاز ۸» باید به قرارداد/schema اضافه شوند؟

> پیشنهاد اولویت‌دار — منوط به تأیید مالک. فعلاً تغییری اعمال نشده است.

1. **بستهٔ اقامت + اجزای مالی** (`AccommodationPackage` + snapshot اجزا در `StayContract`) — NEEDS_REDESIGN روی `ContractRequest.rent`.
2. **غیابت موقت** (`TemporaryAbsence`) + **Credit/Adjustment** — MISSING.
3. **پرداخت‌کننده جدا از ساکن** (`Payer`) — MISSING (روی `Payment`).
4. **وضعیت نگهداری اتاق/تخت** (`RoomMaintenanceStatus`/`BedMaintenanceStatus`) + **درخواست تعمیر/نظافت** (`MaintenanceRequest`) — در طراحی پایه.
5. **تماس اضطراری ساکن** + فیلدهای اختیاری (دانشگاه/مدرک) — MISSING.
6. **تنظیمات عملیاتی لیلیه** (تماس، روز سررسید، سیاست غیابت، امکانات) — MISSING.

## ۵. چه چیزهایی می‌توانند بعداً انجام شوند؟

- تخفیف، صندوق روزانه، خروجی Excel/PDF، مدیریت مهمان/مرخصی، غذا/آشپزخانه، انبار، حقوق کارمندان.
- پاک‌سازی cosmetic نوع `Money` در گزارش‌ها.
- `SyncDevice.platform` enum صریح.

## ۶. تصمیم‌های لازم از مالک

1. آیا «بستهٔ اقامت + غیابت موقت» به قرارداد v0.4 اضافه شود؟ (استراتژیک‌ترین تصمیم)
2. کدام فیلدهای فوق P0 اجباری و کدام P1؟
3. مقدار پیش‌فرض «حداقل روز غیابت» و سیاست کسر (اولین روز کامل یا بعد از آستانه).