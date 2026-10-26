# گردش‌کارهای هدف — اسکان (ESKAN)

هر گردش‌کار با سناریوی پذیرش (AS) و endpointها پیوند دارد.

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

## 7. پرداخت کامل و قسطی (AS-008)
1. `POST /payments` با amount + allocations به charges + Idempotency-Key.
2. مجموع allocation ≤ amount پرداخت؛ مازاد تخصیص‌نیافته می‌ماند.

## 8. ودیعه و برگشت (AS-009)
1. `POST /deposit-transactions` نوع RECEIVED/REFUNDED/FORFEITED.
2. برگشت بیش از مانده رد می‌شود (DEPOSIT_BALANCE_INSUFFICIENT).
3. reverse برای اصلاح رویداد اشتباه.

## 9. مصارف (AS-010)
1. `POST /expenses` (مصرف ثبت‌شده/پرداخت‌شده) → POSTED؛ reversal با دلیل.

## 10. خروج ساکن و پایان قرارداد (AS-006)
1. `POST /contracts/{id}/terminate`؛ پایان assignment؛ نه حذف تاریخچه.

## 11. عملیات آفلاین (AS-014, AS-015)
1. کلاینت mutation را با Idempotency-Key پایدار بعد از اتصال می‌فرستد.
2. `GET /sync/changes?afterSequence=` تغییرات را با cursor برمی‌گرداند.
3. تعارض نسخه با 409 و نسخهٔ فعلی گزارش می‌شود.

## 12. گزارش‌گیری (AS-012)
1. `GET /reports/*` از اسناد معتبر؛ تفکیک charge/payment/deposit/expense.