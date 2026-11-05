# فاز ۹ — پلان مهندسی مالی (Ledger / Charge / Payment / Allocation)

> وضعیت: **پیش‌طراحی (Design Lock)** — این سند تصمیم‌های بنیادی فاز مالی را پیش از نوشتن
> خط کد نهایی می‌کند. اقلام P0 این سند پیش از تولید Charge/Payment پیاده نمی‌شوند.
>
> هدف: با توجه به اینکه اشتباه در Ledger قابل «اصلاح سادهٔ UI» نیست، درستی داده از سرعتِ
> افزودن Endpoint مهم‌تر است. فاز انتقالی 8.2.x نقص‌های هم‌روندی چرخه‌حیات را بست؛ این
> سند آن را به لایهٔ مالی تعمیم می‌دهد.

---

## ۰. وضعیت و پیش‌نیازها

حاصل فاز 8.2.x: قفل سطری (`LockService`) با ترتیب سراسری، idempotency org-scope
(`organizationId + idempotencyKey + endpoint`)، تاریخ کاری برای تصمیم‌های زمانی، و
بسته‌شدن race های activate/update/archive/deactivate/transfer/checkout.

سه تصمیم زیر هنوز باز است و **پیش از پیاده‌سازی مالی** قفل می‌شوند:

| اولویت | تصمیم | نتیجهٔ این سند |
|---|---|---|
| P0 | معنای تاریخ پایان و ثبت `endDate` مؤثر در `terminate` | بخش ۱ |
| P0 | Foreign Key مرکب برای ایزولاسیون Tenant/Resident در روابط مالی | بخش ۳ |
| P0 | قواعد مبلغ/Allocation/Reversal و جلوگیری از Charge تکراری | بخش‌های ۲، ۴–۶ |

---

## ۱. تصمیم نهایی معنای تاریخ (Date/Range Semantics)

**تصمیم:** مدل داخلی دیتابیس **نیمه‌باز `[startDate, endDate)`** می‌ماند؛ اما «روز آخر
اقامت» که کاربر اعلام می‌کند باید **شاملِ** باشد، پس هر عملیات پایان‌دهنده باید
`endDate` را برابر **روز بعد از آخرین شب** ذخیره کند.

- تعداد شب اقامت در یک بازه = `(endDate - startDate)` بر حسب روز.
- اگر ساکن از اول تا ۳۱ جنوری اقامت داشته و ۳۱ جنوری عازم است:
  `startDate = 2026-01-01` ، `endDate = 2026-02-01` → **۳۱ شب** (نه ۳۰).
- «مرز مشترک» انتقال بستر بدون تغییر می‌ماند: تخصیص قبلی در روز `transitionStart`
  تمام می‌شود (endDate = transitionStart) و تخصیص جدید همان روز شروع می‌شود؛ این با
  نیمه‌باز سازگار است و تداخلی با قاعدهٔ inclusived آخرین شب ندارد.

### helper واحد
```ts
// src/common/date/business-date.ts
export function exclusiveEndForInclusiveLastDay(lastDay: string): string {
  // lastDay + 1 روز؛ خروجی YYYY-MM-DD بدون وابستگی به ساعت سرور
}
```

### عملیات‌هایی که اصلاح می‌شوند (در ابتدای فاز ۹)
1. `AssignmentsService.end()`: به‌جای `endDate = businessToday` ، از
   `exclusiveEndForInclusiveLastDay(businessToday)` استفاده شود.
2. `ContractsService.checkout()`: همان قاعده؛ `endDate = روز بعد از امروز`.
3. `ContractsService.terminate()`: **فیلد `endDate` مؤثر** ثبت شود (امروز پایان
   مؤثر است → `endDate = exclusiveEndForInclusiveLastDay(businessToday)`). این دقیقاً
   همان خلأ «قرارداد از چه روزی دیگر کرایه تولید نکند» را می‌بندد.
   - قرارداد در طول بازهٔ `[startDate, terminatedEndDate)` کرایه تولید می‌کند.
4. CHECK های DB بازه (`end_date > start_date` و `daterange [)` ) بدون تغییر می‌مانند؛
   فقط مقدارِ ذخیره‌شده اکنون «انحصاری» است.

> ADR-0009 («روز شروع و روز آخر هر دو حساب شوند») با این قاعده **اجرا** می‌شود: چون
> `endDate` انحصاری است، روز آخر به‌صورت طبیعی داخل بازه می‌ماند.

---

## ۲. قواعد پول و مبلغ

- واحد: AFN؛ ذخیرهٔ صحیح `Int` (واحد فرعی، یعنی «افغانی» کامل). **ممنوعیت کامل float/double**.
- قیود مثبت‌بودن در دیتابیس (نه فقط در لایهٔ برنامه):
  - `Charge.amount > 0` (به جز `ChargeType = ADJUSTMENT` که می‌تواند منفیِ مجاز را
    به‌صورت صریح تجاری بپذیرد؛ در این صورت `amount != 0`).
  - `Payment.amount > 0` ، `DepositTransaction.amount > 0` ، `Expense.amount > 0`.
  - `PaymentAllocation.amount > 0`.
- بازهٔ Charge: `CHECK (period_end > period_start)`.
- API مبلغ را به‌صورت `{ amount, currency }` منتقل می‌کند (الگوی موجود `MoneyDto`).

## ۳. یکپارچگی Tenant با Foreign Key مرکب

### مسئله
روابط مالی فعلاً فقط به `id` والد اشاره می‌کنند (مثلاً `PaymentAllocation.paymentId`
و `chargeId`). این فقط «وجود» والد را تضمین می‌کند، نه «تعلق والد به همان سازمان/ساکن».
سناریوی خطرناک: Payment ساکنِ سازمان A به Charge ساکنِ سازمان B تخصیص یابد.

### راه‌حل: FK مرکب روی `(organizationId, id)`
برای آنکه دیتابیس «والد و فرزند هم‌سازمان‌اند» را تضمین کند:

1. به هر والد یک **یکتایی مرکب** اضافه شود:
   ```prisma
   // Resident, StayContract, Hostel, Bed, Room، و در صورت نیاز User را هم شامل می‌شود
   @@unique([organizationId, id])
   ```
2. فرزندها `organizationId` را نگه می‌دارند و FK مرکب می‌گیرند. مثلاً:
   ```prisma
   model PaymentAllocation {
     id             String @id @default(uuid()) @db.Uuid
     organizationId String @map("organization_id") @db.Uuid
     paymentId      String @map("payment_id")      @db.Uuid
     chargeId       String @map("charge_id")       @db.Uuid
     amount         Int
     // ...
     payment Payment @relation(fields: [organizationId, paymentId], references: [organizationId, id])
     charge  Charge  @relation(fields: [organizationId, chargeId],  references: [organizationId, id])
   }
   ```
3. روابط کلیدی که باید مرکب شوند (فهرست کامل تصویب شده):
   - `PaymentAllocation → Payment` و `PaymentAllocation → Charge` (P0).
   - `Charge → Resident` و `Charge → StayContract` (P0).
   - `Payment → Resident` (P0).
   - `DepositTransaction → Resident` ، `Expense → Hostel` (P0).
   - (اختیاری) `BedAssignment → Bed/Resident/StayContract`؛ اینها فعلاً در لایهٔ برنامه
     محافظت می‌شوند و در یک مرحلهٔ بعدی مرکب می‌شوند.

### استراتژی مهاجرت غیرمخرب
Prisma کاهش FK موجود و جایگزینی مرکب را یکجا نمی‌سازد؛ بنابراین مهاجرت چندمرحله‌ای:
1. `ADD COLUMN organization_id` (بدون NOT NULL) به `payment_allocations` + backfill از والد.
2. ساخت `UNIQUE (organization_id, id)` روی والدها (id قبلاً PK است؛ unique مرکب بی‌خطا بازمی‌گردد).
3. `UPDATE` نهایی NOT NULL؛ سپس `DROP` FK ساده و `ADD` FK مرکب.
4. اعتبارسنجی fail-fast: سطرهای ناسازگار (که نباید وجود داشته باشند) پیش از step 3 رفع می‌شوند.

### قفل‌گذاری و ترتیب سراسری (توسعهٔ LockService)
برای Allocation و Reversal، ترتیب قفل ثابت می‌شود تا deadlock نشود:
`Organization → Resident → StayContract → Charge → Payment`.

---

## ۴. جلوگیری از Charge تکراری (بدون اتکای صرف به Idempotency-Key)

دو درخواست با دو کلید متفاوت برای یک دورهٔ یکسان نباید دو Charge بسازند؛ پس یک
**کلید منطقی یکتا** لازم است:

```prisma
// stay_contracts / charges
@@index([organizationId, residentId, type, periodStart, periodEnd])
```

- برای صدور دوره‌ای (مثلاً کرایهٔ ماهیانه) از `INSERT ... ON CONFLICT DO NOTHING` با
  یک partial unique index روی `(organizationId, residentId, contractId, type,
  periodStart, periodEnd)` استفاده شود تا دو worker هم‌زمان فقط یک Charge بسازند.
- `Idempotency-Key` همچنان برای «پاسخ تکراری همان درخواست» استفاده می‌شود؛ کلید منطقی
  برای «منطق کسب‌وکارِ بدون تکرار» مکمل آن است.

## ۵. قواعد Allocation (تسویهٔ اتمی)

هدف: مجموع Allocation های یک Payment هرگز از «مبلغ تخصیص‌نیافته» بیشتر نشود و مجموع
Allocation های یک Charge هرگز از «ماندهٔ پرداخت‌نشده» بیشتر نشود.

- Allocation همیشه داخل **یک تراکنش** با قفل والدهای `Charge` و `Payment` (به ترتیب
  سراسری بخش ۳) انجام می‌شود:
  1. قفل `Charge` و `Payment`.
  2. خواندن `allocated` فعلی هر دو (بعد از قفل).
  3. بررسی: `amount <= payment.unallocated` و `amount <= charge.outstanding`.
  4. درج Allocation + به‌روزرسانی counters (در صورت نگهداری `allocatedAmount` میان‌جمعی)
     یا محاسبهٔ زندهٔ مجموع با `SELECT ... FOR UPDATE` روی والدها.
- «تسویهٔ کامل» وقتی Charge → وضعیت `SETTLED` (در صورت نیاز افزودن مقدار به enum
  `LedgerEntryStatus` یا یک ستون `settledAt` مجزا) فقط با CAS بر وضعیت/نسخه.
- race دو پرداخت هم‌زمان یک بدهی: قفل والد + بررسی ماندهٔ پس از قفل، مجموع را مهار می‌کند.

## ۶. Reversal سازگار با Allocation ها

- Reversal **حذف نمی‌کند**: یک رکورد جدید با `status = REVERSED` نمی‌سازد؛ بلکه رکورد
  اصلی به `REVERSED` و یک رکورد معکوسِ متقارن (منفی مبلغ) POSTED می‌شود (رویکرد
  دفترداری دوطرفه). تاریخچه همیشه کامل می‌ماند.
- قبل از Reversal یک Charge:
  - اگر Charge هنوز Allocation دارد، Reversal باید ابتدا Allocation ها را آزاد
    (un-allocate) و ماندهٔ Payment مربوطه را برگرداند، سپس Charge را معکوس کند —
    همه در یک تراکنش با CAS روی `version/status`.
  - اگر Charge `SETTLED` است، Reversal پرداخت‌های تخصیص‌یافته را به‌صورت `unapplied`
    باقی می‌گذارد و ماندهٔ ساکن را چشمهٔ قابل پیش‌بینی به‌روز می‌کند.
- قبل از Reversal یک Payment: Allocation ها برگردانده شوند؛ Charge ها دوباره باز (unsettled)
  می‌شوند؛ Payment معکوس می‌شود.
- ثبت `reversalReason` (اجباری) و `reversedBy` و `reversedAt`.

## ۷. Idempotency مالی و Audit Writer

- **Idempotency مالی:** هر mutating مالی (`chargeCreate`, `paymentCreate`,
  `allocationCreate`, `reversalX`) از `IdempotencyService.runAtomic` با scope
  `(organizationId, key, endpoint)` استفاده می‌کند و پاسخ ذخیره‌شده را بازمی‌گرداند.
  - نکته: انقضای lazy فعلی برای سند مالی قابل قبول نیست؛ برای اسناد مالی یک **retention
    ابدی/audit-aware** (بدون پاک‌سازی فیزیکی) در نظر گرفته شود، چون replay یک پرداخت
    حتی ماه‌ها بعد باید به همان رکورد اشاره کند، نه رکورد جدید.
- **Audit Writer (P1):** یک سرویس `AuditService` که Actor را از `CurrentUser` می‌گیرد و
  برای هر عملیات مالی `AuditEvent` (با `actorUserId`، `entityType`, `entityId`, `before`,
  `after`, `traceId`, `ipAddress`, `userAgent`) ثبت می‌کند. رکوردهای مالی بدون Actor
  ثبت نمی‌شوند (رد درخواست بدون توکن معتبر).

---

## ۸. ترتیب اجرای مهاجرت‌ها و ریسک انتشار

مرحله‌بندی (هر مرحله خروجی قابل تست دارد):

1. **M-1 (قواعد بازه/مبلغ):** helper تاریخ + اصلاح `end`/`checkout`/`terminate` +
   CHECK های مبلغ و بازه. بدون تغییر ساختار جدول (فقط constraint).
2. **M-2 (FK مرکب):** مراحل غیرمخرب بخش ۳ (ستون `organizationId` + unique مرکب + swap FK).
3. **M-3 (مالی هسته):** ماژول Charge/Payment/Allocation/Deposit/Expense + lock order +
   anti-duplicate index + allocation اتمی + reversal + idempotency + audit.
4. **M-4 (API/OpenAPI):** مستندسازی نهایی endpoint ها و enum خطاهای مالی؛
   `openapi:validate` سبز.

## ۹. وضعیت تست و CI

- هر مرحله با smoke واقعی (HTTP + بررسی وضعیت نهایی DB) پوشش داده می‌شود؛ برای آزمون
  race های مالی از barrier کنترل‌شده دو درخواست هم‌زمان استفاده می‌شود.
- CI (پیش‌از انتشار): job های `build`، `openapi:validate`، `migrate deploy` روی
  PostgreSQL تمیز، و smoke های فاز مالی. (حال حاضر CI وجود ندارد — به‌عنوان P2 اضافه شود.)
- NOTE محیط فعلی: `jest` (unit) به‌دلیل ناسازگاری ESM در Node حاضر اجرا نمی‌شود؛
  اجرای unit-test ها مستلزم `transformIgnorePatterns`/Node ≥ 24.9 است (جدا از این سند).