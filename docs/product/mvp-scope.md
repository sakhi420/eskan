# محدودهٔ نسخهٔ اول (MVP Scope) — اسکان

این سند scope را قفل می‌کند؛ هر endpoint/جدول به نیازمندی MVP وصل است.

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

## تعریف «کامل بودن»

یک قابلیت فقط وقتی complete است که معیارهای پاراگراف «تعریف Done» (بخش G
مسترپرامپت) پاس شود؛ تعداد فایل/endpoint معیار نیست.

## تصمیم ثبت‌شده

- درخواست ترمیمات و دعوت عضو در ابتدا خارج از هستهٔ MUST است؛ در صورت زمان
  بعد از تکمیل هستهٔ اقامت/مالی اضافه می‌شوند.
- هیچ قابلیت بدون requirement ساخته نمی‌شود.