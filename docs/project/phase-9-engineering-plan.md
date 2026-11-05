# فاز ۹ — پلان مهندسی مالی (نسخهٔ ۰.۲ — Design Lock)

> **وضعیت:** Design Lock نهایی‌شده برای مبلغ، تاریخ، FK مرکب، Allocation/Reversal،
> anti-duplicate، غیابت چندماهه، Idempotency مالی و Receipt، با ترتیب Contract-first.
> این سند جمع‌بندی Findingهای ممیزی 0.2 است و **پیش از M-1/M-2 هیچ migration مالی
> اجرا نمی‌شود**.
>
> موارد با برچسب **تصمیم باز (D-xx)** نیازمند تصمیم صریح مالک محصول‌اند و تا آن
> تصمیم، در کد به‌عنوان قانون قطعی hard-code نمی‌شوند.

---

## ۰. اصول تقدم و مراجع لازم‌الاجرا

- A-016: `Money = { amount: integer, currency: "AFN" }`؛ **فقط AFN**؛ بدون Float/Double.
- ADR-0008: اسناد مالی posted حذف نمی‌شوند؛ اصلاح با status/metadata و event معکوس
  انجام می‌شود؛ **مبلغ منفی مجاز نیست**.
- ADR-0004: OpenAPI منبع حقیقت قرارداد API است و باید **پیش از ساخت Controller** تثبیت شود.
- ADR-0009: روز شروع و روز آخر اقامت هر دو در proration شمرده می‌شوند.
- PostgreSQL: `CHECK` نمی‌تواند aggregate چندردیفی را تضمین کند؛ سقف مجموع با
  قفل/transaction/trigger اتمیک پیاده می‌شود. FK مرکب به Unique/PK مرجع و index سمت
  فرزند نیاز دارد؛ deadlock با ترتیب سراسری قفل + retry محدود مدیریت می‌شود.

---

## ۱. معنای تاریخ پایان — قطعی (F-20)

**تصمیم:** مدل DB و API نیمه‌باز `[startDate, endDate)` می‌ماند؛ «آخرین روز اقامت» که
به کاربر نشان داده می‌شود **شاملِ** است. پس هر پایانِ ناشی از «آخرین شب اقامت» باید
`endDate = lastDay + 1` ذخیره کند.

```
occupiedDays  = endDate - startDate        (بر حسب روز، در قالب int/bigint)
lastOccupiedInclusive = endDate - 1
```

### helper واحد
```ts
// src/common/date/business-date.ts
export function exclusiveEndForInclusiveLastDay(lastDay: string): string; // lastDay + 1
```

### قواعد پایان
- **Checkout/Assignment.end (خروج در روز D):** `endDate = D + 1`؛ یعنی `exclusiveEnd > startDate`
  شرط validity است (نه `today <= startDate`). یک اقامت یک‌روزه (خروج همان روز شروع) **معتبر** است
  و در proration درست یک شب/روز شمرده می‌شود. guard فعلی بر این اساس بازنویسی شود.
- **Transfer:** تاریخ انتقال مرز مشترک است؛ `old.endDate = transitionStart` (بدون `+1`)
  و `new.startDate = transitionStart`. به هیچ‌وجه `+1` اعمال نمی‌شود.
- **Terminate (پایان مؤثر):** فیلد `endDate` مؤثر ثبت می‌شود (نه فقط `status=TERMINATED`).
  - تصمیم D-01 (تصمیم باز): Terminate روی `DRAFT` به معنی «لغو» است یا ممنوع؟ (پیشنهاد: DRAFT → لغو،
    ACTIVE → پایان مؤثر؛ بدون backdate در MVP مگر نظر مالک).
  - مؤثر بودن بازهٔ کرایه: `[startDate, terminatedEndDateExclusive)`.
  - `reversalReason`/`reversedBy`/`reversedAt` روی terminate ثبت شود.

### سیاست داده‌های legacy (F-20.3)
- **پاک‌سازی blanket `+1 day` ممنوع.** برخی `endDate`های فعلی حاصل Transfer هستند (مرز دقیق) و
  نباید جابه‌جا شوند.
- از این نسخه، `BedAssignment.endReason` (enum: `CHECKOUT | TRANSFER | TERMINATE | MANUAL_END`)
  اضافه شود تا علت پایان ذخیره باشد. برای رکوردهای قبلی، یک **preflight/preview** بنویس که
  هرAssignment فعال‌خاتمه‌یافته را دسته‌بندی کند (transfer vs end) و:
  1. نتیجه را به‌صورت گزارش (تعداد/نمونه) نمایش دهد؛
  2. فقط پس از تأیید صریح، backfill کند؛
  3. پایان‌های Transfer را دست نخورده نگه دارد.
- API بین `lastOccupiedDateInclusive` (UX) و `endDateExclusive` (DB/API) تمایز روشن داشته باشد؛
  نام `endDate` در قرارداد با description صریح شود.

### آزمون اجباری تاریخ
اقامت یک‌روزه، خروج روز شروع، خروج آخر ماه، عبور از مرز ماه، انتقال همان‌روز، terminate،
و تطابق `occupiedDays` با الگوی independent oracle برای ماه‌های ۲۸/۲۹/۳۰/۳۱روزه.

## ۲. قواعد مبلغ و جهت — قطعی (F-17, F-04, F-26)

**تصمیم قطعی:** هیچ مبلغ منفی در هیچ مدل مالی ذخیره/منتقل نمی‌شود. مبلغ همهٔ اسناد
(`Charge`, `Payment`, `Allocation`, `Deposit`, `Expense`, `Credit`, `Reversal event`)
**بزرگ‌تر از صفر** است. جهت اثر مالی با فیلد صریح بیان می‌شود، نه با علامت مبلغ.

- یک enum `LedgerSide { DEBIT, CREDIT }` اضافه شود؛ `Charge.entrySide` پیش‌فرض `DEBIT`.
  - بدهی عادی = `DEBIT` (ماندهٔ ساکن را افزایش می‌دهد).
  - اعتبار غیابت/تخفیف = `CREDIT` (مانده را به‌صورت مثبت کاهش می‌دهد، بدون مبلغ منفی).
- **Reversal مستقل از Credit:** Reversal یک سند منفیِ متقارن نمی‌سازد؛ سند اصلی
  `status=REVERSED` می‌شود و یک `LedgerReversal` append-only با `amount > 0`,
  `direction` همان‌طرف سند اصلی، و reference به سند اولیه ثبت می‌شود.
- حد range مبلغ: DTO با `@Min(1)` و سقف صریح `2_147_483_647` (int32). صفر برای سند مالی رد می‌شود.
- جمع/نسبت: `decimal.js` برای proration و rounding half-up؛ هرگز Float/Double.
- Aggregate گزارش (جمع مانده/دریافت) از `bigint`/`decimal` در SQL استفاده کند و بدون
  ازدست‌دادن دقت به response serialize شود.

---

## ۳. یکپارچگی Tenant و Resident با FK مرکب — قطعی (F-18, F-07)

### مسئلهٔ اضافه نسبت به نسخهٔ قبل
FK مرکبِ فقط `(organizationId, id)` جلوی این حالت را نمی‌گیرد: Payment متعلق به Resident A
و Charge متعلق به Resident B، در یک Organization. لذا **Resident نیز باید در FK دخیل شود**.

### کلیدهای مرجع
```prisma
model Resident     { @@unique([organizationId, id]) }
model StayContract { @@unique([organizationId, id])  @@unique([organizationId, residentId, id]) }
model Charge       { @@unique([organizationId, id])  @@unique([organizationId, residentId, id]) }
model Payment      { @@unique([organizationId, id])  @@unique([organizationId, residentId, id]) }
```

### PaymentAllocation (تغییر ساختار)
```prisma
model PaymentAllocation {
  id             String @id @default(uuid()) @db.Uuid
  organizationId String @map("organization_id") @db.Uuid
  residentId     String @map("resident_id")  @db.Uuid
  paymentId      String @map("payment_id")   @db.Uuid
  chargeId       String @map("charge_id")    @db.Uuid
  amount         Int    // > 0
  // append-only؛ بدون mutate/delete

  payment Payment @relation(fields: [organizationId, residentId, paymentId], references: [organizationId, residentId, id])
  charge  Charge  @relation(fields: [organizationId, residentId, chargeId],  references: [organizationId, residentId, id])
}
```
- در نتیجه Payment و Charge همواره هم‌Organization و هم‌Resident اند.
- `Charge → StayContract` (وقتی `contractId` غیر null): FK مرکب
  `(organizationId, residentId, contractId)` → StayContract، تا Contract متعلق به همان
  Resident باشد.
- `TemporaryAbsence → Charge` و هر relation دیگر دارای resident نیز همین قاعده.

### قفل‌گذاری tenant-scoped (F-07)
- `LockService.lockForUpdate` امضای `(tx, entity, id, organizationId?)` بگیرد و در صورت
  وجود، `WHERE id=$1 AND organization_id=$2 FOR UPDATE` اجرا کند تا یک tenant نتواند ردیف
  tenant دیگر را قفل/Block کند (کاهش DoS بین سازمان‌ها).

### مهاجرت غیرمخرب (M-2)
1. preflight: شمارش cross-tenant **و** cross-resident referenceها (query های ممیزی)؛
   در صورت وجود، fail-fast بدون mutate.
2. ساخت unique های مرکب روی والدها.
3. `ADD COLUMN organization_id/resident_id` (nullable) + backfill از والدها.
4. NOT NULL نهایی؛ `DROP` FK ساده و `ADD` FK مرکب با حفظ onDelete و ساخت index فرزند.
5. rehearsal روی clone/staging الزامی است.

## ۴. جلوگیری از Charge تکراری — قطعی (F-23, F-06)

`Idempotency-Key` فقط retry را حل می‌کند؛ جلوگیری از سند تکراری با **unique business key**:

```sql
-- کرایهٔ ماهانه: فقط یک Charge به ازای (contract, period)
CREATE UNIQUE INDEX uq_charge_rent_period
  ON charges (organization_id, contract_id, period_start, period_end)
  WHERE type = 'RENT' AND contract_id IS NOT NULL;
```

- Charge نوع `RENT` باید `contractId` غیر null داشته باشد (validation + CHECK).
- برای credit/Adjustment غیابت، key منبع یکتا: `(organization_id, source_type, source_id, period_start, period_end)`.
- درج با `INSERT ... ON CONFLICT DO NOTHING` (یا `createMany/skipDuplicates`) تا دو worker فقط یک ردیف بسازند.

---

## ۵. Allocation و Reversal — قطعی (F-19, F-03, F-05)

### Allocation append-only
- `PaymentAllocation` فقط append می‌شود؛ **amount تغییر نمی‌کند و row حذف نمی‌شود**.
- برگشت تخصیص با یک رخداد مستقل `AllocationRelease` (append-only, amount>0) با reference
  به Allocation ثبت می‌شود؛ مجموع releaseها هرگز از amount اصلی بیشتر نمی‌شود.
- **حذف** `@@unique([paymentId, chargeId])`: یک Payment می‌تواند در عملیات‌های بعدی دوباره
  به همان Charge (پس از release) تخصیص یابد. uniqueness بر اساس `operation id/idempotency
  source` است، نه محدودیت مادام‌العمر Payment+Charge.

### invariant اتمیک (در یک transaction)
1. قفل Resident (طبق ترتیب سراسری)؛
2. قفل Chargeهای درگیر (مرتب بر اساس UUID) و Payment؛
3. بازخوانی status و جمع Allocationهای فعال **پس از قفل**؛
4. کنترل: `allocation.amount <= charge.outstanding` و `<= payment.unallocated`؛
5. درج Allocation (و در صورت لزوم بروزرسانی cached settlement با CAS).

### تفکیک وضعیت اعتبار از وضعیت تسویه
- `LedgerEntryStatus { POSTED, REVERSED }` فقط وضعیت **اعتبار** سند است.
- وضعیت تسویه (`OPEN | PARTIAL | SETTLED`) derived (از outstanding) یا به‌صورت cached field
  با نگهداری اتمیک باشد؛ در `LedgerEntryStatus` مشترک مخلوط نشود.

### Reversal (void) و refund واقعی جدایند
- **Void (باطل‌کردن سند اشتباه):** سند اصلی `REVERSED` + `LedgerReversal` append-only؛
  Allocationهای معتبرِ Charge در صورت وجود باید ابتدا release/تعیین‌تکلیف شوند، وگرنه reversal
  block می‌شود.
- **Refund واقعی (خروج وجه):** یک رویداد خروج وجه مستقل (مثلاً `PaymentRefund`)؛ با void یکی نیست.
- تصمیم D-02 (تصمیم باز): آیا partial reversal لازم است؟ (پیشنهاد MVP: فقط full void + refund کامل؛
  partial در صورت نیاز بعدی).

## ۶. غیابت چندماهه و Credit — قطعی (F-21, F-04)

یک `TemporaryAbsence` عبوری از مرز ماه چند Credit ماهانه تولید می‌کند؛ `creditChargeId`
تک‌مقداری کافی نیست. بنابراین:

```prisma
model AbsenceCredit {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  absenceId      String   @map("absence_id")  @db.Uuid
  chargeId       String   @map("charge_id")   @db.Uuid
  periodStart    DateTime @map("period_start") @db.Date
  periodEnd      DateTime @map("period_end")   @db.Date
  amount         Int      // > 0

  absence TemporaryAbsence @relation(fields: [organizationId, absenceId], references: [organizationId, id])
  charge  Charge           @relation(fields: [organizationId, residentId, chargeId], references: [organizationId, residentId, id])
  // @@unique([organizationId, absenceId, periodStart, periodEnd])
}
```
- یک غیابت → چند سطر `AbsenceCredit` (یک سطر به ازای هر ماه).
- unique = absence + دوره (نه صرفاً absence) تا نتوان دو Credit برای یک ماه ساخت.
- Credit مربوطه از نوع `Charge` با `entrySide = CREDIT` و `amount > 0` است.

---

## ۷. Idempotency مالی و Receipt numbering — قطعی (F-22, F-16, F-25)

### Idempotency مالی (بدون انقضای lazy)
- `IdempotencyRecord.expiresAt` nullable شود + افزودن `retentionClass` (مثلاً
  `TRANSIENT | PERMANENT`). رکورد `PERMANENT` در `getReplay` **هرگز lazy-delete نمی‌شود**.
- `runAtomic` باید `retentionClass` بگیرد؛ مسیر مالی از `PERMANENT` استفاده کند تا replay
  یک پرداخت، ماه‌ها بعد به همان رکورد اشاره کند (نه رکورد جدید).
- رکورد مالی فقط fingerprint/response canonical نگه می‌دارد؛ **secrets/raw refresh token
  ذخیره نمی‌شود**؛ purge policy نباید رکورد مالی را دوباره قابل اجرا کند (یا soft-archive).

### Receipt numbering
- شمارنده به ازای `(organizationId, period)` (مثلاً سال) باشد؛ درج اتمی با قفل ردیف روی
  `ReceiptCounter`.
- **gap policy (تصمیم D-03):** شمارهٔ رسید unique و پایدار است؛ gapless بودن تضمین نمی‌شود
  مگر الزام حقوقی/عملیاتی صریح باشد.
- **Offline:** دستگاه آفلاین یک `provisionalReceiptId` محلی می‌سازد؛ شمارهٔ قطعی سازمانی فقط
  سمت سرور صادر می‌شود و در sync بازگردانده می‌شود. دو شناسه جدا نگه داشته شوند.

### ترتیب سراسری قفل (F-03, F-07) و deadlock
`Organization → Resident → StayContract → Charge* (مرتب بر اساس UUID) → Payment* (مرتب)
→ Allocation* (مرتب) → ReceiptCounter → SyncState`
- همهٔ mutationهای مالی از همین ترتیب استفاده کنند؛ deadlock با retry محدود + خطای
  serialization آگاهانه مدیریت شود.

## ۸. ترتیب اجرا — Contract-first — قطعی (F-24)

ADR-0004: OpenAPI منبع حقیقت است؛ پس قرارداد مالی **پیش از Controller** قفل می‌شود.

| مرحله | محتوا | خروجی / Gate |
|---|---|---|
| **Gate 0 — Design Lock** | رفع تناقض‌های فوق + تصویب D-01..D-18 | این سند (نسخهٔ 0.2) commit شود؛ هیچ P0 باز نماند |
| **Gate 1 — Contract Lock** | OpenAPI برای Charge/Allocation/AllocationRelease/Deposit/Expense/Credit/Account/Statement، enum خطاها، `lastOccupiedDateInclusive` vs `endDateExclusive`، permission matrix، replay | `openapi:validate` سبز؛ **قبل از هر Controller** |
| **M-1 — Date + Amount** | helper تاریخ، اصلاح `end`/`checkout`/`terminate`، same-day، CHECK های amount/period، preflight legacy date (بدون blanket +1) | test تاریخ + oracle |
| **M-2 — Composite FK** | unique مرکب (tenant+resident)، ستون‌های org/resident در Allocation، preflight cross-org/resident، swap FK | rehearsal روی clone |
| **M-3a — Charge/Credit Engine** | Charge، natural key، cycle/proration، credit/adjustment، idempotency، audit + oracle ماه‌های ۲۸..۳۱ |
| **M-3b — Payment/Allocation Engine** | Payment + receipt + allocation/release append-only + invariant اتمی + race test |
| **M-3c — Deposit/Expense/Reversal** | deposit scope، refund/forfeit، expense، void/refund واقعی، reconcile |
| **M-3d — Account/Statement/Audit/Sync** | read models، statement، append-only audit + outbox در همان transaction |
| **M-4 — Parity & Release** | Controllerها طبق OpenAPI قفل‌شده، CI، Jest ESM fix، integration، migration rehearsal |

> M-4 دیگر «اولین طراحی API» نیست؛ مرحلهٔ تطبیق نهایی و Release Gate است.

---

## ۹. وضعیت GO / NO-GO

| فعالیت | تصمیم |
|---|---|
| ادامهٔ Phase 9-A (اصلاح پلن و قفل تصمیم‌ها) | **GO** |
| قفل OpenAPI مالی (Gate 1) | **GO — پیش از Controller** |
| اجرای M-1 | **NO-GO** تا تصویب D-01 (terminate) و D-04 (legacy cutover) و amount>0 |
| اجرای M-2 | **NO-GO** تا finalization resident-consistency و preflight |
| پیاده‌سازی Charge/Payment/Allocation | **NO-GO** تا Gate 0/1 و رفع F-03/F-04/F-05/F-06/F-17..F-26 |
| انتشار عمومی | **NO-GO** تا CI/Jest، tenant-scoped lock، OpenAPI drift و Refresh recovery |

---

## ۱۰. تصمیم‌های باز مالک محصول (D-xx)

| شناسه | تصمیم | پیشنهاد مهندسی |
|---|---|---|
| D-01 | Terminate روی DRAFT (= لغو) یا ممنوع | DRAFT = لغو؛ ACTIVE = پایان مؤثر؛ بدون backdate در MVP |
| D-02 | partial reversal لازم است؟ | MVP: full void + refund کامل |
| D-03 | نیاز به gap-less receipt number | gap مجاز؛ unique و پایدار کافی است |
| D-04 | سیاست cutover تاریخ legacy | preflight/preview + تأیید صریح؛ انتقال پایان‌ها بدون +1 |
| D-05 | آیا ساکن می‌تواند با پیش‌پرداخت/credit بدهی ساکن دیگر را تسویه کند؟ | خیر؛ FK/قفل resident همواره یکسان |
| D-06 | `NEEDS_REPAIR` روی منبع اشغال‌شده مجاز؟ | جدول transition مجاز Maintenance تعریف شود (پیش‌از Release سند شود) |
| D-07..D-18 | voucher، deposit refund جزئی، statement format، partial credit و … | در assumptions/open-questions ثبت و با مالک تصویب شود |

---

## پیوست — آدرس منابع ممیزی 0.2

خروجی این سند، اعمال یافته‌های زیر از گزارش 0.2 است: F-17 منفی/جهت، F-18 resident-consistency،
F-19 append-only allocation/reversal، F-20 legacy/same-day/terminate، F-21 multi-month credit،
F-22 idempotency permanent، F-23 unique business key، F-24 contract-first، F-26 int/overflow،
F-03/F-05/F-07 قفل و refund واقعی. مبلغ مثبت، بدون signed-negative، مطابق A-016 و ADR-0008.