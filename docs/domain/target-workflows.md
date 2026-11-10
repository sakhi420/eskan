# گردش‌کارهای هدف — اسکان (ESKAN)

هر گردش‌کار با سناریوی پذیرش (AS) و endpointها پیوند دارد.

> **وضعیت اجرا (2026-11-10):** این سند گردش‌کار **هدف** است. مسیرهای پرداخت/تخصیص/ودیعه/refund/statement
> (M3b/M3c/M3d) هنوز در Backend اجرا نشده‌اند؛ چرخهٔ کامل غیابت (درخواست/تأیید/ثبت خروج/تأیید بازگشت) نیز
> هنوز پیاده‌سازی نشده (فقط تولید Credit پس از `RETURNED` در M3a موجود است).

## 1. ایجاد سازمان و اولین مدیر (AS-001)
1. کاربر `POST /auth/register` با ایمیل/رمز/نام سازمان.
2. سرور در یک transaction: user + organization + membership(OWNER) می‌سازد.
3. اگر ثبت آزاد غیرفعال باشد 403 `REGISTRATION_DISABLED`.

## 2. ورود/خروج/تمدید نشست (AS-002)
1. `POST /auth/login` → access (کوتاه) + refresh (چرخشی).
2. `POST /auth/refresh` → refresh چرخش؛ reuse نشانهٔ نشت → revoke نشست.
3. `POST /auth/logout` (جاری)، `POST /auth/logout-all` (همه).

## 3. مدیریت لیلیه/اتاق/بستر (AS-004)
1. `POST /hostels`؛ `POST /hostels/{id}/rooms`؛ `POST /rooms/{id}/beds`.
2. archive/deactivate فقط وقتی هیچ assignment فعال ندارد.
3. کد اتاق در لیلیه و کد بستر در اتاق یکتا است.

## 4. ثبت ساکن (AS-005)
1. `POST /residents` با نام کامل + نوع؛ تماس اختیاری.
2. timeline و account با `GET` قابل بازیابی.

## 5. قرارداد و تخصیص بستر (AS-006, AS-007)
1. `POST /contracts` (DRAFT) → `activate` (ACTIVE) → `terminate`/`closed`.
2. `POST /bed-assignments` با بازه `[start,end)`؛ overlap رد می‌شود.
3. `POST /bed-assignments/{id}/end` پایان idempotent.

## 6. کرایه/صورتحساب (AS-008)
1. `POST /charges` (RENT/...؛ period + amount + dueDate) → POSTED.
2. مانده از charges منهای allocations محاسبه می‌شود.

## 7. پرداخت و تخصیص (AS-008) — دو عملیات مستقل (D-02/D-05)
1. `POST /payments` فقط Payment را به‌صورت **وجه تخصیص‌نیافته (unapplied)** ثبت می‌کند + `Idempotency-Key`؛ رسید رسمی فقط پس از commit سرور (D-03/D-17).
2. `POST /payments/{paymentId}/allocations` — تخصیص **صریح** بخشی/کل Payment به Chargeهای مشخص (فقط همان Resident/Org).
3. مجموع allocation ≤ amount پرداخت و ≤ ماندهٔ Charge؛ مازاد unapplied می‌ماند.
4. `POST /allocations/{allocationId}/release` — آزادسازی تخصیص (append-only؛ رویداد مستقل).
5. Void (ابطال سند اشتباه) ≠ Refund واقعی (خروج وجه) — دو مسیر مجزا (D-02).

## 8. ودیعه و برگشت (AS-009)
1. `POST /deposit-transactions` نوع RECEIVED/REFUNDED/FORFEITED.
2. برگشت بیش از مانده رد می‌شود (DEPOSIT_BALANCE_INSUFFICIENT).
3. reverse برای اصلاح رویداد اشتباه.
4. اعمال ودیعه روی بدهی فقط در Checkout نهایی با انتخاب صریح Charge توسط OWNER/ADMIN (D-10)؛ ودیعه به‌صورت خودکار بدهی را تسویه نمی‌کند و در حساب مستقل نمایش داده می‌شود.

## 9. مصارف (AS-010)
1. `POST /expenses` (مصرف ثبت‌شده/پرداخت‌شده) → POSTED؛ reversal با دلیل.

## 10. خروج و پایان قرارداد (AS-006)
1. قرارداد `DRAFT` → فقط **لغو** (بدون خاتمهٔ مالی).
2. قرارداد `ACTIVE` → منحصراً از مسیر **Checkout اتمیک** `POST /contracts/{contractId}/checkout` (بستن قرارداد + پایان همهٔ تخصیص‌های فعال در یک transaction با یک `effectiveEndDate`) — نه پایان دادن تخصیص‌ها بدون بستن قرارداد (D-01).
3. پایان هیچ سابقهٔ تاریخی‌ای را حذف نمی‌کند.

## 11. عملیات آفلاین (AS-014, AS-015)
1. کلاینت mutation را با Idempotency-Key پایدار بعد از اتصال می‌فرستد.
2. `GET /sync/changes?afterSequence=` تغییرات را با cursor برمی‌گرداند.
3. تعارض نسخه با 409 و نسخهٔ فعلی گزارش می‌شود.

## 12. گزارش‌گیری (AS-012)
1. `GET /reports/*` از اسناد معتبر؛ تفکیک charge/payment/deposit/expense.