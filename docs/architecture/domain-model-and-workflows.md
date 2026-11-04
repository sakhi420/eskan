# مدل دامنه و جریان‌های کاری — اسکان (ESKAN)

- **تاریخ:** 2026-11-04
- **وضعیت:** طراحی مرجع دامنه (پیشنهادی). بخش «موجود» با Prisma Schema/قرارداد فعلی تطبیق دارد؛ بخش «پیشنهادی» نیازمند تصمیم مالک قبل از تغییر schema.

## ۱. ساختار سازمانی (موجود)

```
Organization → Hostel → Room → Bed
```

- `OrganizationSubscription`, `SubscriptionPlan` برای اشتراک نرم‌افزار — **جدا از مالیهٔ ساکنان**.
- `OrganizationMembership` (نقش OWNER/ADMIN/OPERATOR/VIEWER)، `User`، `Invitation`، `RefreshSession`.
- ایزولاسیون tenant: همهٔ موجودیت‌های تجاری `organizationId` دارند و از `MembershipContext` scope می‌شوند.

## ۲. موجودیت‌های اصلی اقامت و مالی

### ۲.۱ موجود (در schema فعلی)

| موجودیت | فیلدهای کلیدی | نکته |
|---|---|---|
| `Hostel` | name, address, notes, status | بدون تماس/تنظیمات/امکانات |
| `Room` | code, floor, notes, status | بدون نوع/امکانات/ظرفیت |
| `Bed` | code, notes, status(ACTIVE/INACTIVE) | بدون وضعیت نگهداری |
| `Resident` | fullName, type, phone, notes, status | بدون تماس اضطراری/payer |
| `StayContract` | contractNumber, status, start/endDate, rentAmount, billingCycle, depositAmount | کرایهٔ تختِ واحد (بدون اجزای بسته) |
| `BedAssignment` | bedId, residentId, contractId, start/endDate, status | جلوگیری از overlap با btree_gist |
| `Charge` | type(RENT/UTILITY/DAMAGE/OTHER), amount, period, dueDate, reversal | تعهد مالی |
| `Payment` | amount, method, receivedAt, receiptNumber, reversal | وصول |
| `PaymentAllocation` | paymentId, chargeId, amount | تخصیص جزئی |
| `DepositTransaction` | type(RECEIVED/REFUNDED/FORFEITED), amount, reversal | ودیعه |
| `Expense` | category, amount, spentAt, paymentMethod, reversal | مصارف |

### ۲.۲ پیشنهادی (نیازمند تصمیم مالک — قبل از فاز ۸)

| مفهوم | هدف |
|---|---|
| `AccommodationPackage` (یا معادل) | تعریف بستهٔ اقامت با اجزای accommodation/board/services و پرچم «قابل‌کسر در غیاب» |
| Snapshot اجزای بسته در قرارداد | حفظ قیمت/اجزای تاریخی قرارداد |
| `TemporaryAbsence` | غیابت موقت: تاریخ خروج/بازگشت، وضعیت، تأیید، تولید credit |
| `Payer` (پرداخت‌کننده جدا از Resident) | ثبت شخص پرداخت‌کننده بدون انتقال پروندهٔ اقامت |
| `MaintenanceRequest` / `MaintenanceStatus` اتاق-تخت | ثبت خرابی + وضعیت `NeedsCleaning/NeedsRepair/Ready` |
| `RoomInspection` (اختیاری) | بازرسی ورود/خروج + خسارت |

## ۳. روابط کلیدی

- `Resident 1—N StayContract N—1 Hostel`.
- `Resident 1—N BedAssignment N—1 Bed`؛ `StayContract 1—N BedAssignment`.
- `Resident 1—N Charge / Payment / DepositTransaction`.
- `Payment 1—N PaymentAllocation N—1 Charge`.
- `Charge.contractId` اختیاری (برای صورتحساب رند بعداً لینک قرارداد).
- **پیشنهادی:** `TemporaryAbsence → Resident + StayContract`؛ credit غیابت → یک `Charge` از نوع adjustment یا موجودیت credit مستقل (بدون پاک کردن سوابق).

## ۴. جریان‌های کاری اصلی

### ۴.۱ پذیرش (Admission)

```
ثبت ساکن → انتخاب لیلیه → نمایش تخت‌های آزاد → انتخاب تخت
→ ثبت قرارداد (بسته + کرایه + ودیعه) → پرداخت اولیه (در صورت دریافت) → تکمیل پذیرش
```

- tخت آزاد = وضعیت ACTIVE + بدون `BedAssignment` فعال.

### ۴.۲ انتقال اتاق/تخت (Move)

- پایان assignment فعلی + ایجاد assignment جدید در یک transaction؛ تاریخ‌ها بدون overlap و بدون gap غیرموجه.

### ۴.۳ خروج (Check-out)

- پایان assignment، خاتمه/بستن قرارداد، تسویهٔ مانده، بازپرداخت/مصادرهٔ ودیعه، ثبت وضعیت اتاق (`NeedsCleaning/NeedsRepair`).

### ۴.۴ تولید کرایهٔ ماهانه (idempotent)

- مدیر در ابتدای ماه «تولید کرایه» می‌زند → برای قراردادهای فعال، Charge یک‌بار ساخته شود.
- **Idempotency:** یک ماه/قرارداد دو بار صورتحساب نسازد (کلید طبیعی: contractId + billing period).
- قبل از ثبت نهایی، خلاصهٔ افراد/مبلغ‌ها نمایش داده شود.

### ۴.۵ غیابت موقت (پیشنهادی)

```
ثبت غیابت (خروج/بازگشت برنامه‌ریزی) → احراز حداقل روز → تأیید/اصلاح مدیر
→ محاسبهٔ سهم غذا/خدمات قابل‌کسر → ایجاد adjustment/credit (appended؛ بدون بازنویسی)
→ بازگشت واقعی (زودتر/دیرتر) → محاسبهٔ نهایی
```

### ۴.۶ تعمیرات/نظافت (P1؛ طراحی از ابتدا)

```
ثبت درخواست (عنوان/محل/اولویت/مسئول) → new → in_progress → resolved/cancelled
اتاق: Occupied → NeedsCleaning/NeedsRepair → Ready
```

## ۵. اصول حاکم (خلاصه)

- اسناد مالی posted حذف فیزیکی نمی‌شوند؛ اصلاح با reversal/credit.
- مبلغ‌ها عدد صحیح AFN (A-016)؛ بدون FLOAT/DOUBLE.
- عملیات مالی/اقامت چندجدولی در transaction.
- version + optimistic locking روی موجودیت‌های mutable.
- Idempotency برای writes.
- tenant isolation سرتاسری.