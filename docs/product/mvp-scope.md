# محدودهٔ نسخهٔ اول (MVP Scope) — اسکان

این سند **مرجع اصلی محدودهٔ MVP، پلتفرم‌ها، اولویت‌ها (P0/P1/P2)، قابلیت‌های
Must/Should/Future، تعریف Done و محدوده‌های خارج از MVP** است. محتوای یکتای
`mvp-prioritization.md` و `hostel-domain-requirements-v1.md` (هر دو آرشیو شده) در اینجا
یکپارچه شده‌اند. در صورت تعارض، این سند با تصمیم‌های تأییدشدهٔ مالک
(A-013..A-016 و D-01..D-18) هم‌تراز است.

## پلتفرم‌های هدف (تصمیم ثبت‌شده)

- کلاینت‌های اولیه: **Android** و **Windows Desktop** با **Flutter/Dart**.
- Backend مشترک NestJS + PostgreSQL و API مشترک `/api/v1` برای هر دو کلاینت.
- یک codebase مشترک Flutter؛ اشتراک منطق/مدل‌ها/API client/sync؛ UI سازگار با هر دو.
- Windows Desktop: صفحه‌کلید، جدول، جست‌وجو، گزارش‌ها و چاپ رسید.
- آفلاین: SQLite/Drift + sync با Backend.
- iOS/macOS/Web خارج از اهداف اولیه (بررسی در مراحل بعد). در فاز 5 فقط Backend؛ بدون اپ Flutter.

## MUST (هستهٔ اقامت و مالی)

| قابلیت | نیازمندی | ماژول/جدول |
|--------|----------|------------|
| auth و ثبت مالک/ورود/refresh/logout | REQ-F-001/002 | users, refresh_sessions |
| tenant isolation و نقش‌ها | REQ-F-019 | organizations, organization_memberships |
| پروفایل سازمان و اعضا | REQ-F-003 | organizations, memberships |
| لیلیه/اتاق/بستر + archive | REQ-F-004/005/006 | hostels, rooms, beds |
| ساکن | REQ-F-007 | residents |
| قرارداد اقامت | REQ-F-008 | stay_contracts |
| تخصیص/پایان تخصیص بستر + overlap | REQ-F-009 | bed_assignments |
| صورتحساب + reversal | REQ-F-010 | charges |
| دریافت + allocation + reversal | REQ-F-011 | payments, payment_allocations |
| ودیعه + reverse | REQ-F-012 | deposit_transactions |
| هزینه + reversal | REQ-F-013 | expenses |
| حساب ساکن/تاریخچه | REQ-F-014 | (view/query) |
| گزارش‌های پایه | REQ-F-015 | reports |
| audit | REQ-F-016 | audit_events |
| sync pull + tombstone | REQ-F-017 | sync_devices, sync_changes, organization_sync_state |
| idempotency/تعارض | REQ-F-018 | idempotency_records |
| OpenAPI کامل + migrations + تست واقعی PG | REQ-NF-008 | contracts/openapi.yaml, prisma/ |
| Docker Compose + راه‌اندازی | REQ-NF-013 | docker-compose.yml |

## SHOULD

| قابلیت | وضعیت |
|--------|--------|
| درخواست ترمیمات | SHOULD؛ بعد از هستهٔ مالی |
| دعوت عضو با توکن یک‌بارمصرف | SHOULD؛ مدیریت عضو ساده در MVP |
| export CSV امن | SHOULD |
| فیلترهای پیشرفته گزارش | SHOULD |

## FUTURE (خارج از MVP)

پرداخت آنلاین/بانک، SMS/OTP، اپ ساکن، پنل وب، حسابداری دوطرفه/مالیات،
چند ارز، microservices/Kafka/Redis، GraphQL، webhook، تحلیل پیشرفته،
accounts payable (بدهی به تأمین‌کننده).

## تعریف «کامل بودن» (Done)

یک قابلیت فقط وقتی complete است که به‌صورت مستقل قابل استفاده باشد (تعداد فایل/endpoint معیار نیست):

1. در `contracts/openapi.yaml` (نسخهٔ فعلی 0.5.0) تعریف شده باشد.
2. مدل/جداول لازم در `prisma/schema.prisma` و migration معتبر داشته باشد.
3. سرویس/منطق اجرایی در `src/` داشته باشد (صرف وجود در OpenAPI یا Schema کافی نیست).
4. validation، tenancy/BOLA، idempotency و audit لازم را رعایت کند.
5. روی PostgreSQL واقعی تست مرتبط (unit/integration/e2e یا migration) داشته باشد و در CI سبز باشد.
6. خطاها را با RFC 9457 Problem Details (`code` پایدار + `traceId`) برگرداند.

## تصمیم ثبت‌شده

- درخواست ترمیمات و دعوت عضو در ابتدا خارج از هستهٔ MUST است؛ در صورت زمان
  بعد از تکمیل هستهٔ اقامت/مالی اضافه می‌شوند.
- هیچ قابلیت بدون requirement ساخته نمی‌شود.

---

## اولویت‌بندی (P0/P1/P2)

- **P0:** هستهٔ قابل‌فروش اقامت — باید در MVP باشد.
- **P1:** مهم برای مدیریت بهتر؛ طراحی پایه از ابتدا، اجرا بعد از هسته.
- **P2:** تخصصی/آینده.

| گروه | P0 (هسته) | P1 | P2 |
|---|---|---|---|
| اقامت | لیلیه/اتاق/تخت، بستهٔ اقامت + snapshot، وضعیت استفاده | ثبت گروهی اتاق/تخت | ساختمان/بلوک (مجموعه‌های بزرگ) |
| ساکن | پروندهٔ پایه + تماس اضطراری؛ بدون الزام موبایل؛ تلفن غیریکتا | اطلاعات تکمیلی (دانشگاه/رشته) | — |
| پذیرش | پذیرش→تخت→قرارداد→کرایه/ودیعه→پرداخت→تکمیل؛ انتقال؛ Checkout اتمیک | — | — |
| مالی | کرایهٔ ماهانه idempotent، پرداخت دستی + پرداخت‌کنندهٔ جدا، ودیعه، مصارف، بدهی، رسید، Credit/Adjustment، گزارش بدهکاران | تخفیف | — |
| گزارش/رسید/صندوق | داشبورد، بدهی، خلاصهٔ مالی، statement، رسید | خروجی Excel/PDF، بستن صندوق روزانه | — |
| کاربران/نقش/آفلاین | OWNER/ADMIN/OPERATOR/VIEWER + Platform Admin، Offline-first، Backup/Restore | — | — |
| نگهداری | وضعیت پایهٔ نگهداری بستر (OPERATIONAL/NEEDS_CLEANING/NEEDS_REPAIR/OUT_OF_SERVICE) بدون خراب‌کردن اشغال (D-06) | درخواست تعمیر/نظافت، بازرسی ورود/خروج | — |
| سایر | — | شکایت/درخواست ساکن، گزارش حضور/غیابت | مهمان/مرخصی، رویداد/حادثه، یادآوری |

> **مهم:** «مدیریت کامل تعمیرات» با «قواعد پایهٔ وضعیت نگهداری بستر» یکسان نیست. وضعیت نگهداری (P0 — طبق D-06) از ابتدا مدل‌سازی می‌شود؛ گردش‌کار کامل تعمیرات P1 است.

## کاربران هدف و مدل‌های عملیاتی لیلیه

- مشتری اصلی: **مالک/مدیر لیلیهٔ خصوصی کوچک و متوسط** در افغانستان.
- هر دو گروه ساکن: **محصلین/دانشجویان** و **کارگران/کارمندان** — یک محصول؛ تفاوت فقط در اطلاعات تکمیلی Resident (`ResidentType`: STUDENT/WORKER/OTHER).
- ساکن برای ثبت‌شدن **الزاماً نه حساب کاربری دارد و نه گوشی هوشمند**. پرداخت‌کننده می‌تواند با ساکن متفاوت باشد؛ بدهکار همچنان همان Resident است (D-05/D-13).
- مدل‌های اقامتی پشتیبانی‌شده: فقط اقامت / اقامت+غذا / اقامت+خدمات / بستهٔ کامل — بدون تحمیل مدل ثابت (جزئیات: `hostel-service-packages-and-absence-policy.md`).

## روش‌های پرداخت دستی (بدون درگاه)

`CASH`، `BANK_TRANSFER`، `MOBILE_MONEY`، `OTHER`. هیچ درگاه بانکی، پرداخت آنلاین یا اتصال خودکار کیف‌پول در MVP وجود ندارد.

## Offline-first و Backup/Restore

- کلاینت Flutter با SQLite/Drift آفلاین کار می‌کند؛ نوشتنی‌ها queue شده و پس از اتصال با `Idempotency-Key` پایدار replay می‌شوند (قرارداد هدف: `docs/api/offline-sync.md`).
- Backup محلی کلاینت مستقل از Sync است.
- Backup مرکزی (PostgreSQL) دوره‌ای + تمرین Restore واقعی قبل از pilot (الزام مستقل از Sync).
- عملیات حساس (صدور رسید رسمی) فقط پس از commit موفق سرور (D-03/D-17).