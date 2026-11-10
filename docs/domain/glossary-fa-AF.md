# واژه‌نامهٔ دامنه و اصطلاحات — اسکان (ESKAN)

زبان مستندات و رابط: دری افغانستان. متن API از زبان نمایشی مستقل است.

| اصطلاح | تعریف | نام فنی/Enum |
|--------|-------|--------------|
| سازمان | مرز مالکیت داده‌ها و امنیت یک کسب‌وکار | `Organization` |
| لیلیه | یک مرکز اقامتی متعلق به سازمان | `Hostel` |
| اتاق | فضای داخل لیلیه | `Room` |
| بستر | جای خواب مشخص داخل اتاق | `Bed` |
| ساکن | شخص مقیم | `Resident` |
| قرارداد اقامت | توافق اقامت با شرایط مالی و تاریخ مستقل | `StayContract` |
| تخصیص بستر | سابقهٔ اختصاص بستر به ساکن | `BedAssignment` |
| صورتحساب/تعهد | تعهد مالی صورتحساب‌شده | `Charge` |
| دریافت | وجه دریافتی واقعی | `Payment` |
| تخصیص دریافت | مصرف بخشی از دریافت برای صورتحساب | `PaymentAllocation` |
| ودیعه/تضمین | وجه تضمین جدا از کرایه | `DepositTransaction` |
| مصرف/هزینه | هزینهٔ ثبت‌شده و پرداخت‌شده | `Expense` |
| رخداد حسابرسی | سابقهٔ عملیات حساس | `AuditEvent` |
| تغییر همگام‌سازی | اعلام تغییر برای کلاینت‌ها | `SyncChange` |
| مالک | صاحب سازمان، کنترل کامل | `OWNER` |
| مدیر | مدیریت عملیاتی | `ADMIN` |
| اپراتور | ثبت عملیات روزمره | `OPERATOR` |
| مشاهده‌گر | فقط خواندن | `VIEWER` |

| بستهٔ اقامت | تعریف خدمات/هزینهٔ اقامت با اجزای مالی قابل‌کسر/ثابت | `AccommodationPackage` |
| صورت‌حساب ماهانه | اجرای idempotent کرایهٔ ماهانه (Preview→Posted) | `BillingRun` |
| غیابت موقت | دوری موقت ساکن با حفظ تخت و قرارداد فعال | `TemporaryAbsence` |
| اعتبار غیابت | Credit صادره پس از تأیید بازگشت واقعی (بعد از `RETURNED`) | `AbsenceCredit` |
| آزادسازی تخصیص | لغو تخصیص ثبت‌شدهٔ پرداخت (append-only) | `AllocationRelease` |
| شمارندهٔ رسید | شمارهٔ رسمی یکتای افزایشی در سطح سازمان | `ReceiptCounter` |

## انواع ساکن

| Enum | معنای دری | توضیح |
|------|-----------|-------|
| `STUDENT` | محصل/دانشجو | نیازمند اطلاعات تکمیلی تحصیلی در آینده |
| `WORKER` | کارگر/کارمند | — |
| `OTHER` | سایر | برای موارد غیر از دو دستهٔ بالا |

## وضعیت قرارداد

`DRAFT` (پیش‌نویس) → `ACTIVE` (فعال) → `TERMINATED` (خاتمه‌یافته) | `CLOSED` (بسته‌شده).

## وضعیت اسناد مالی

- Charge: `POSTED` → `REVERSED` (دوبدهی/دوبستان = وجه با `entrySide` / `ChargeType` متناظر).
- Payment: `POSTED` → `REVERSED`؛ Payment در ابتدا **وجه تخصیص‌نیافته (unapplied)** است و Allocation عملیات مستقل است.
- PaymentAllocation: append-only؛ آزادسازی با رویداد `AllocationRelease`، نه حذف/بازنویسی.
- Expense: `POSTED` → `REVERSED`.
- DepositTransaction: رویداد مستقل `RECEIVED` / `REFUNDED` / `FORFEITED` (اصلاح اشتباه با reverse).
- Refund واقعی (خروج وجه) از Void (ابطال سند اشتباه) جداست (D-02). مبلغ منفی هیچ‌جا مجاز نیست (A-016).

## وضعیت ساکن

`ACTIVE`, `INACTIVE`, `ARCHIVED` (archive تاریخچه را پنهان نمی‌کند).

## وضعیت تخصیص بستر

`ACTIVE`, `ENDED`. بازه `[startDate, endDate)`؛ `endDate` تهی یعنی باز.

## چرخهٔ کرایه

`BillingCycle` معادل `MONTHLY` در MVP (کرایهٔ ماهانه). proration **قطعی است** (A-015):
`monthlyRent × occupiedDays / calendarDaysInMonth`، شمول دوطرفهٔ روزها، گردکردن HALF_UP با decimal.js.

## واحد پول

پیش‌فرض `AFN` (افغانی). مبلغ عدد صحیح افغانی است (`Money { amount: integer, currency: "AFN" }` طبق A-016)؛ API مبلغ اسناد منفرد را integer و مبالغ تجمیعی حساب/گزارش را string (تا ۱۹ رقم) منتقل می‌کند؛ هرگز FLOAT/DOUBLE.

## منطقهٔ زمانی

timestamp ثبت سمت سرور UTC (`timestamptz`). تاریخ کاری `DATE` (`YYYY-MM-DD`). timezone ارائهٔ گزارش `Asia/Kabul`.