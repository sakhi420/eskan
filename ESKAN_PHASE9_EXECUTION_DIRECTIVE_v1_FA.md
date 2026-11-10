# دستور اجرایی قطعی فاز ۹ اسکان — نسخهٔ ۱.۰

**مخزن:** `sakhi420/eskan`  
**خط مبنا (به‌روز 2026-11-10):** ادامهٔ کار از آخرین `origin/main` — commit `41af931e8be5ef194670989cae603c6cb1c51eca` (Merge PR #2) انجام شود؛ هیچ reset یا rebase به commitهای قبلی انجام نشود.
**مالک محصول و تصمیم نهایی:** Nisar (مالک پروژه). ایجنت/دستیار نقش تحلیل، مشاوره، بررسی و اجرای مأموریت تأییدشده را دارد؛ پیشنهادِ بدون تأیید مالک به تصمیم قطعی تبدیل نمی‌شود.  
**نقش ایجنت/دستیار:** اجرا، بررسی و تحویل مأموریت تأییدشده؛ بازگشایی تصمیم‌های D-01 تا D-18 این سند و تحویل صرفاً مستندات به‌جای کد قابل قبول نیست.

---

## 1. فرمان اصلی

این سند مرجع اجرایی فاز ۹ است و تصمیم‌های D-01 تا D-18 در آن **تصویب‌شده و قطعی** محسوب می‌شوند. دیگر برای هر کدام از این تصمیم‌ها از مالک سؤال نکن. طرح v0.3 فاز ۹ از نظر تصمیم‌های محصول با این سند تکمیل می‌شود؛ در صورت تعارض، این سند مقدم است.

**خروجی قابل قبول، کد اجرایی است.** تحویل صرفاً سند، جدول پیشنهاد، اسکلت خالی، DTO بدون سرویس، endpoint بدون منطق، migration بدون تست یا گزارش «این طراحی خوب است» مردود است.

عامل باید Gateها را به ترتیب اجرا کند، در هر Gate کد و تست واقعی تحویل دهد و سپس به Gate بعد برود. فقط در صورت مانع فنی اثبات‌شده‌ای که امکان اجرای امن را واقعاً متوقف می‌کند، متوقف شود؛ در آن صورت شواهد، فرمان شکست‌خورده و گزینهٔ فنی پیشنهادی را ارائه کند. ابهام‌های عادی را با همین تصمیم‌های قطعی حل کند.

## وضعیت اجرای M-gates (به‌روز 2026-11-10)

این سند **تنها دستور اجرایی فعال فاز ۹** است. وضعیت زیر از واقعیت GitHub / Migration / کد / CI روی `origin/main` (commit `41af931e8be5ef194670989cae603c6cb1c51eca`) استخراج شده است:

| Gate | وضعیت | شواهد |
|---|---|---|
| M-1 (تاریخ/مبلغ/Checkout) | ✅ تکمیل و ادغام‌شده | `test-m1-migration.cjs` سبز در CI؛ D-01 / D-04 |
| M-2 (Composite Tenant/Resident Integrity) | ✅ تکمیل و ادغام‌شده | migration `20261107120000_...`، preflight روی clone واقعی، `test-m2-migration.cjs` |
| 4c (Lifecycle Versioning + Idempotency Retention) | ✅ تکمیل و ادغام‌شده | migrations `20261108180000_...` و `20261108190000_...`؛ `IdempotencyService.retentionClass` |
| M3a (Charge/Billing/Absence-Credit) | ✅ تکمیل و ادغام‌شده (PR #2) | `src/charges`، `contracts/openapi.yaml` v0.5.0، `test-m3a-migration.cjs` + integration سبز |
| **M3b (Payment/Receipt/Allocation/Release)** | 🔜 **نقطهٔ بعدی اجرا** | گپ واقعی: مدل Prisma `ReceiptCounter`/`AllocationRelease` و قفل مالی در `LockService` هنوز ساخته نشده |
| M3c (Deposit/Refund/Expense/Reversal) | بعد از M3b | — |
| M3d (Account/Statement/Audit/Sync Pull) | بعد از M3c | Write-side Audit/Sync (M3a) ≠ تکمیل Pull/Tombstone/Resync |

**ادامهٔ کار:** از همین `origin/main` شروع کن؛ M3b نخستین گام بعدی است. هیچ تصمیم D-01 تا D-18 باز نمی‌شود و سؤال تکراری از مالک مطرح نمی‌شود.

## 2. محدوده و اصول ثابت محصول

- محصول برای مدیریت لیلیه‌های خصوصی کوچک و متوسط افغانستان است؛ هم لیلیهٔ محصلین و هم کارگران/کارمندان، در یک محصول.
- Backend: NestJS + TypeScript + Prisma + PostgreSQL، به شکل Modular Monolith.
- کلاینت‌های هدف: Flutter مشترک برای Android و Windows Desktop؛ پایگاه محلی SQLite/Drift. در این فاز Flutter ساخته نمی‌شود، ولی API باید برای آن آماده باشد.
- ارز MVP فقط AFN و همهٔ مبلغ‌های اسناد منفرد عدد صحیح مثبت‌اند؛ Float/Double و مبلغ منفی ممنوع.
- درگاه پرداخت، اتصال بانک و checkout درون‌برنامه‌ای وجود ندارد. ثبت دریافت نقدی/انتقال بانکی/موبایل‌مانی فقط دستی است.
- Payment ساکن از ManualSubscriptionPayment اشتراک ESKAN کاملاً جداست.
- Charge تعهد ساکن است؛ Payment وجه دریافت‌شده است؛ Allocation رابطهٔ پرداخت با بدهی است؛ Deposit تضمین جداگانه است؛ Expense فقط مصرف پرداخت‌شده است.
- ودیعه به‌صورت خودکار بدهی را تسویه نمی‌کند. استفاده از ودیعه برای بدهی فقط با انتخاب صریح مدیر در تسویهٔ نهایی مجاز است.
- اسناد مالی قطعی حذف یا بازنویسی نمی‌شوند. رویدادهای اصلاحی، برگشت و audit append-only هستند.
- Tenant و Resident consistency باید در دیتابیس با FK مرکب enforce شود؛ application validation به‌تنهایی کافی نیست.

## 3. تصمیم‌های محصولی قفل‌شده — D-01 تا D-18

| ID | تصمیم لازم‌الاجرا |
|---|---|
| D-01 | قرارداد DRAFT فقط لغو می‌شود. قرارداد ACTIVE فقط با Checkout اتمیک خاتمه می‌یابد: بستن قرارداد و تمام BedAssignmentهای فعال در یک transaction و با یک تاریخ مؤثر واحد. Backdate در MVP ممنوع است؛ تاریخ کاری از timezone سازمان، پیش‌فرض `Asia/Kabul`، به‌دست می‌آید. |
| D-02 | Partial reversal در MVP وجود ندارد. Void سند اشتباه کامل است. اصلاح مالی جزئی با Charge/Credit مستقل و مثبت ثبت می‌شود. Refund واقعی وجه، رویداد خروج وجه جداگانه است و با Void یکی نیست. |
| D-03 | شمارهٔ رسمی رسید در سطح Organization یکتا و افزایشی است؛ reset سالانه ندارد. Gap مجاز است؛ شماره هرگز دوباره استفاده نمی‌شود. شمارهٔ رسمی فقط پس از commit موفق سرور صادر می‌شود. |
| D-04 | تاریخ‌های legacy بدون شواهد تغییر نمی‌کنند. هیچ `+1 day` عمومی، backfill حدسی یا جابه‌جایی Transfer اجرا نشود. رکورد قدیمی با `endReason = null` به‌عنوان LEGACY_UNKNOWN حفظ می‌شود؛ همهٔ عملیات جدید باید endReason صریح ذخیره کنند. Billing خودکار برای دوره‌های تاریخی مبهم اجرا نشود. |
| D-05 | Payment و Charge باید به همان Organization و همان Resident تعلق داشته باشند. تسویهٔ بدهی Resident A با Payment متعلق به Resident B ممنوع است. |
| D-06 | منبع اشغال‌شده به `NEEDS_REPAIR` یا `OUT_OF_SERVICE` تغییر نمی‌کند. `NEEDS_CLEANING` می‌تواند وضعیت عملیاتی جداگانه باشد و نباید اشغال را از بین ببرد. |
| D-07 | Voucher/Coupon در MVP وجود ندارد. تخفیف دستی فقط با Credit مثبت، دلیل اجباری، Actor و مجوز OWNER/ADMIN ثبت می‌شود. |
| D-08 | Refund ودیعه کامل یا جزئی مجاز است. جمع Refund + Forfeit + AppliedToCharges هرگز از مبلغ دریافت‌شدهٔ معتبر ودیعه بیشتر نمی‌شود. |
| D-09 | Forfeit ودیعه کامل یا جزئی فقط با دلیل، Actor و مجوز OWNER/ADMIN است؛ عملیات خودکار یا بی‌دلیل ممنوع است. |
| D-10 | اعمال ودیعه روی بدهی فقط در Checkout نهایی، با انتخاب صریح Chargeها و مبلغ توسط OWNER/ADMIN انجام می‌شود. در transaction واحد، سهم ودیعه کم و یک Payment داخلی از نوع `DEPOSIT_APPLICATION` همراه Allocation متناظر ایجاد می‌شود؛ این عملیات Cash Receipt نیست و در گزارش وجه نقد شمرده نمی‌شود. |
| D-11 | حداقل غیابت پیش‌فرض ۳ روز تقویمی متوالی و در تنظیمات هر لیلیه قابل تغییر است. پس از احراز آستانه، اعتبار از اولین روز کامل غیابت محاسبه می‌شود؛ Accommodation هرگز قابل کسر نیست؛ فقط componentهای snapshot با `deductibleOnAbsence=true` مشمول‌اند. |
| D-12 | Credit غیابت فقط پس از تأیید actual return ساخته می‌شود. تاریخ‌ها با بازهٔ نیمه‌باز `[actualDepartureDate, actualReturnDate)` محاسبه می‌شوند؛ روز بازگشت کسر نمی‌شود. غیابت چندماهه به دوره‌های تقویمی ماهانه شکسته می‌شود. مبلغ هر component در هر ماه با روزهای همان ماه و rounding نیم‌به‌بالا محاسبه و breakdown آن حفظ می‌شود. Charge/Credit قطعی بعداً ویرایش نمی‌شود. |
| D-13 | اطلاعات پرداخت‌کنندهٔ ثالث در Payment اختیاری است (`payerName`, `payerPhone`, `payerRelation`). بدهکار همچنان Resident متصل به Payment است. |
| D-14 | Expense در MVP فقط هزینهٔ واقعاً پرداخت‌شده است؛ Accounts Payable و بدهی به فروشنده ساخته نمی‌شود. |
| D-15 | Statement ساکن شامل ماندهٔ آغازین، Chargeهای Debit، Creditها، Paymentها، Allocation/Release، Refund/Void و ماندهٔ پایانی است. سه bucket مستقل نمایش داده شود: Outstanding Receivable، Unapplied Payment/Credit و Deposit Held. ودیعه داخل بدهی/طلب عادی ادغام نشود. |
| D-16 | روش‌های دستی: `CASH`, `BANK_TRANSFER`, `MOBILE_MONEY`, `OTHER`. ثبت روش یعنی ثبت دستی اطلاعات؛ هیچ API بانکی/درگاه یا تأیید خودکار ساخته نشود. |
| D-17 | کلاینت آفلاین می‌تواند Payment محلی با `provisionalReceiptId` بسازد. این شماره رسمی نیست. سرور فقط پس از پذیرش و commit، receiptNumber رسمی را اختصاص می‌دهد و mapping را برمی‌گرداند. |
| D-18 | حذف فیزیکی اسناد مالی ممنوع. Void/Refund/Forfeit/Adjustment باید مجوز، دلیل مناسب، Actor، زمان سرور، businessDate و AuditEvent داشته باشد. OWNER/ADMIN مجاز به برگشت/تعدیل/Forfeit/اعمال ودیعه‌اند؛ OPERATOR فقط عملیات روزمرهٔ ثبت ساکن، قرارداد، Charge عادی، Payment، تخصیص، دریافت/ثبت ودیعه و Expense را انجام می‌دهد؛ VIEWER فقط خواندن. |

### قواعد تکمیلی محاسبات

1. دورهٔ ماهانه به شکل `[periodStart, nextPeriodStart)` ذخیره شود.
2. اقامت و Charge ناقص ماه: `monthlyAmount × occupiedDays / calendarDaysInMonth` با Decimal دقیق و half-up.
3. برای بستهٔ چندجزئی، منبع مبلغ فقط package snapshot قرارداد است؛ قیمت روز package روی قرارداد قبلی اثر نمی‌گذارد.
4. برای Charge ماهانهٔ بسته، breakdown componentها در snapshot/line breakdown حفظ شود؛ مبلغ کل با جمع مبالغ جزء ساخته شود. برای absence credit نیز componentهای واجد شرایط جدا محاسبه شوند و breakdown immutable ذخیره گردد.
5. `occupiedDays = endDateExclusive - startDate`. خروج در روز D یعنی آخرین روز اشغال‌شده D و `endDateExclusive = D + 1`. Transfer مرز است: assignment قبلی در تاریخ انتقال پایان انحصاری می‌یابد و assignment جدید همان روز آغاز می‌شود؛ در Transfer هیچ `+1` اعمال نشود.
6. هر سند منفرد: `1 <= amount <= 2,147,483,647`. برای aggregateهای گزارش از `bigint/numeric` استفاده و بدون تبدیل غیرایمن به JS Number serialize شود؛ در صورت احتمال عبور از safe integer، aggregate به رشتهٔ رقم صحیح در API برگردد.

## 4. مدل دقیق Subledger و گردش مالی

ESKAN در MVP **Resident Receivables Subledger** است، نه حسابداری دوطرفه/دفتر کل قانونی.

### 4.1 Charge و Credit

- Charge بدهی عادی با `entrySide=DEBIT` است.
- Credit/تخفیف/absence credit یک posting با `entrySide=CREDIT` و amount مثبت است.
- `LedgerEntryStatus` فقط `POSTED | REVERSED` را نشان می‌دهد؛ وضعیت تسویه `OPEN | PARTIAL | SETTLED` از outstanding محاسبه شود یا cache اتمیک و قابل بازسازی باشد.
- Charge نوع `RENT` حتماً `contractId` دارد و partial unique index روی `(organization_id, contract_id, period_start, period_end)` دارد.
- Credit غیابت natural key یکتا بر اساس `(organizationId, sourceType, sourceId, periodStart, periodEnd)` دارد.

### 4.2 Payment، Allocation و Release

- Payment یک دریافت واقعی مثبت و immutable است؛ Payment به Resident بدهکار وصل می‌شود.
- Payment جدید ابتدا به‌صورت unapplied ثبت می‌شود. Allocation یک عملیات جدا و صریح است؛ هیچ auto-allocation پنهانی انجام نشود.
- هر Allocation مثبت و append-only است؛ مقدارش تغییر نمی‌کند و ردیف آن حذف نمی‌شود.
- آزادسازی Allocation با `AllocationRelease` مثبت و append-only است.
- هم‌زمانی Release: در transaction، Allocation اصلی قفل شود؛ مجموع Releaseهای معتبر خوانده شود؛ شرط `releasedTotal + newRelease <= allocation.amount` بررسی و سپس event درج شود.
- هم‌زمانی Allocation: Resident، Chargeها با UUID مرتب، سپس Paymentها با UUID مرتب قفل شوند؛ outstanding و unallocated بعد از قفل دوباره محاسبه شود؛ Allocation فقط در صورت کفایت هر دو سقف ثبت شود.
- حذف unique مادام‌العمر `(paymentId, chargeId)` مجاز است؛ uniqueness باید بر operation/idempotency باشد.
- overpayment ماندهٔ بدهی منفی نمی‌سازد؛ به صورت Unapplied Payment/Credit باقی می‌ماند.

### 4.3 Reversal، Void و Refund

- هر posting اصلی و reversal event در دفتر باقی می‌مانند. `REVERSED` بودن سند اصلی آن را از محاسبه حذف نمی‌کند.
- `LedgerReversal` amount مثبت و جهت مخالف posting اصلی دارد: `DEBIT ↔ CREDIT`. جهت همان سند اصلی ممنوع است.
- Void یک Charge دارای Allocation فقط پس از Release کامل Allocationهایش ممکن است؛ در همان transaction Charge به REVERSED می‌رود، AllocationReleaseها ثبت می‌شوند و LedgerReversal مخالف ثبت می‌شود. Payment آزادشده Unapplied می‌ماند؛ سیستم پول را خودکار به Charge دیگر وصل نمی‌کند.
- Void یک Payment تنها پس از آزادسازی همهٔ Allocationهای آن ممکن است؛ LedgerReversal مخالف posting پرداخت ثبت می‌شود. Void به معنی خروج وجه از صندوق نیست.
- Refund واقعی Payment یک `PaymentRefund` مستقل و Cash Outflow است. در MVP فقط از بخش Unapplied همان Payment قابل Refund است؛ مبلغ Refund از Unapplied balance بیشتر نشود. برای Refund مبلغی که قبلاً Allocate شده، ابتدا Allocation صریحاً Release شود.
- Partial document reversal در MVP ممنوع است؛ partial refund ودیعه جدا از این قاعده مجاز است.

### 4.4 Deposit و Expense

- Deposit ledger/bucket جداست: `Held = Received - Refunded - Forfeited - AppliedToCharges`.
- `DepositTransaction` رویداد append-only است؛ `RECEIVED`, `REFUNDED`, `FORFEITED`, `APPLIED_TO_CHARGES` از هم جدا هستند. هیچ ردیفی mutate/delete نشود.
- Deposit application مطابق D-10 یک Payment داخلی `DEPOSIT_APPLICATION` می‌سازد و به Chargeهای انتخاب‌شده تخصیص می‌دهد؛ در Cash Received گزارش نمی‌شود.
- Forfeit درآمد/Payment ساکن یا Expense نیست؛ در گزارش ودیعه جدا نشان داده شود.
- Expense فقط هزینهٔ پرداخت‌شده است؛ void آن با event برگشت immutable و reason/actor ثبت شود.

## 5. معماری Offline-first که Backend باید پشتیبانی کند

این معماری قطعی است؛ عامل Backend فقط قرارداد و backend-side نیازهایش را می‌سازد، نه Flutter.

1. Android و Windows با یک Flutter codebase، SQLite/Drift و Backend مشترک استفاده می‌کنند.
2. Repository در کلاینت منبع واحد خواندن UI است؛ readها از دیتابیس محلی می‌آیند. Remote API منبع حقیقت مرکزی و داور نهایی تعارض است.
3. هر write آفلاین در Outbox پایدار محلی با operation UUID، endpoint، canonical payload، expectedVersion، dependency references و `Idempotency-Key` ذخیره می‌شود. Idempotency-Key هنگام retry یا restart هرگز regenerate نمی‌شود.
4. Outbox dependency-aware است: parent قبل از child ارسال می‌شود. کلاینت `localId → serverId` mapping را پس از ACK به شکل اتمیک ذخیره می‌کند؛ تا وقتی parent به serverId تبدیل نشده، child با local ID به سرور ارسال نمی‌شود.
5. Delivery در شبکه at-least-once است؛ اثر منطقی effectively-once از idempotency دائمی/unique business key حاصل می‌شود. ادعای exactly-once transport ممنوع.
6. برای mutationهای قابل صف‌شدن آفلاین، idempotency metadata را PERMANENT و سبک نگه دار: key، endpoint/scope، request fingerprint، resource/result reference و response metadata. پاسخ حساس یا secret ذخیره نشود. TTL سی‌روزه برای operationهایی که client می‌تواند بیش از ۳۰ روز آفلاین نگه دارد ممنوع است. رکوردهای transient فقط برای endpointهای غیرقابل صف‌شدن مجازند.
7. Pull sync از `sync_changes` با sequence سازمانی monotonic و commit-order استفاده کند؛ entity mutation + audit + sync change + idempotency در یک transaction باشند.
8. Client صفحهٔ pull را در یک transaction محلی اعمال می‌کند و فقط بعد از موفقیت کل صفحه cursor را جلو می‌برد. Tombstone و `resyncRequired` پشتیبانی شوند.
9. Last-write-wins برای Charge/Payment/Allocation/Deposit/Contract/BedAssignment/Role ممنوع. Conflict نسخه 409 است؛ Outbox عملیات را نگه می‌دارد تا کاربر آن را resolve کند یا با اختیار مجاز لغو کند.
10. Payment آفلاین با provisional receipt و وضعیت `PENDING_SYNC` دیده می‌شود؛ تا ACK سرور، رسید رسمی و دریافت قطعی مرکزی تلقی نمی‌شود.
11. BedAssignment/Transfer آفلاین تا پاسخ سرور `PENDING_SYNC`/موقت است؛ کلاینت نباید به کاربر تضمین قطعی اشغال تخت بدهد. Conflictهای رقابت چند دستگاه در سرور با constraint و transaction حل می‌شوند.
12. پایان Trial/اشتراک نباید read/export یا ثبت/همگام‌سازی عملیات مالی ضروری برای Residentهای موجود را به‌طور کورکورانه متوقف کند. Limitها روی ایجاد منابع جدید و عبور از سقف enforce شوند؛ Payment/Allocation/Settlement برای پرونده‌های موجود ادامه یابد. هیچ client timestamp برای دورزدن entitlement پذیرفته نشود.
13. Backup محلی SQLite با Sync یکی نیست. معماری و محصول باید این دو را مستقل نگه دارند؛ سرور نیز backup/restore عملیاتی مستقل دارد.

## 6. تطبیق با بازار واقعی افغانستان و Scope

این تصمیم‌ها بر اساس تحقیق ثبت‌شده در `docs/research/afghanistan-private-hostel-operating-model.md` و شواهد عمومی زیر گرفته شده‌اند؛ گزارش‌های دانشجویی نمونه‌ای‌اند و آمار جامع کل بازار نیستند:

- در گزارش ۸صبح مورخ ۲۹ اپریل ۲۰۲۶، دو مدل مالی متفاوت گزارش شده: حدود ۷۰۰۰ AFN با غذا و حدود ۵۰۰۰ AFN بدون غذا/با هزینه‌های جدا؛ دامنهٔ ۵۰۰۰ تا ۱۰۰۰۰ AFN بر حسب امکانات گزارش شده است. این‌ها قیمت نمونه‌اند، نه price list یا قیمت seed.
- گزارش ۸صبح مورخ ۲۴ سپتمبر ۲۰۲۶ نیز از شکایت دربارهٔ ازدحام، آب/برق، غذا، بهداشت و فضای مطالعه و تفاوت تبلیغ با خدمات واقعی سخن می‌گوید؛ هم‌زمان دیدگاه مدیر لیلیه دربارهٔ فشار هزینهٔ ساختمان/غذا را نیز نقل می‌کند.
- Salam Watandar در ۲۵ اپریل ۲۰۲۶، مصاحبهٔ ۲۰ دانشجو از ۸ ولایت را منتشر کرده؛ یافته‌ها دربارهٔ آب، برق، بهداشت، حریم خصوصی و ازدحام، مصاحبه‌ای است نه نمایندهٔ کل کشور.
- دادهٔ Enterprise Survey بانک جهانی برای افغانستان در ۲۰۲۵ مقدار حدود ۴۱.۸۳٪ شرکت‌های تجربه‌کنندهٔ قطعی برق را نشان می‌دهد؛ این آمار مختص لیلیه نیست اما ریسک اتکای کامل به آنلاین را تأیید می‌کند.
- بانک جهانی در November 2025 reach خدمات Mobile Money را محدود توصیف می‌کند؛ بنابراین مسیر اصلی MVP پول نقد و ثبت دستی است، نه درگاه خودکار.

### نتیجهٔ محصولی

- پکیج‌های قابل ترکیب Accommodation / Board / Service و snapshot حفظ شوند؛ یک مدل «همه‌چیز شامل» اجباری نکن.
- مدیریت موجودی آشپزخانه، محاسبهٔ وعده‌به‌وعده، marketplace رزرو تخت، اپ ساکن، دوربین/امنیت، ERP، payroll و حسابداری قانونی وارد این فاز نشوند.
- maintenance/cleaning/complaint tracking در backlog عملیاتی بعد از هستهٔ مالی اولویت داشته باشد؛ وضعیت maintenance پایهٔ فعلی حفظ شود.
- هیچ مبلغ بازار در seed/default price قرار نگیرد. قیمت به‌ازای package و تنظیم لیلیه باقی بماند.
- پس از MVP، pilot واقعی با لیلیه‌های دانشجویی و کارگری در حداقل ۵ تا ۱۰ محل انجام شود؛ تا پیش از آن ادعای product-market fit یا سهم بازار نشود.

## 7. تصمیم زیرساخت و هزینهٔ اولیه

- برای development، نمایش دانشگاهی و تست، از منابع رایگان/محلی استفاده شود.
- برای pilot با دادهٔ واقعی مالی/شخصی، دیتابیس روی free tier خواب‌دار/ephemeral یا بدون backup قابل اتکا قرار نگیرد. کم‌هزینه‌ترین طرح قابل قبول: یک سرویس Backend کوچک و PostgreSQL پایدار با backup خودکار رمزگذاری‌شده و آزمون restore. در مقیاس اولیه Redis/Kafka/Kubernetes/microservices لازم نیست.
- در شروع single-region و single-instance قابل قبول است؛ اما backup روزانه، retention مشخص، مانیتورینگ سلامت و آزمون restore قبل از ورود مشتری واقعی الزامی‌اند.
- نام provider و انتخاب دقیق VPS/managed database در این فاز قفل نشود؛ پیش از خرید، قیمت و شرایط روز providerها جدا بررسی شود. «رایگان برای همیشه» فرض معماری نباشد.

## 8. برنامهٔ اجرای فاز ۹ — ترتیب اجباری

### Gate 0 — Baseline و آماده‌سازی تست (بدون schema mutation)

1. شاخه، commit و working tree را ثبت کن؛ مبنا آخرین `origin/main` است (پس از ادغام PR #2؛ commit `41af931e8be5ef194670989cae603c6cb1c51eca`). یک branch اجرایی مستقل بساز؛ force push ممنوع.
2. `npm ci`, `npm run build`, `npm run openapi:validate`, `npx prisma validate`, `npx prisma generate` و تست‌های موجود را اجرا و خروجی واقعی را ثبت کن.
3. وضعیت migration دیتابیس dev/test را بررسی کن؛ روی دیتابیس production یا دادهٔ واقعی migration آزمایشی اجرا نکن.
4. Jest ESM مشکل‌دار را در همین Gate حل کن یا test runner سازگار تثبیت کن؛ suite را skip/delete نکن. اگر CI وجود ندارد، workflow واقعی build + OpenAPI + Prisma + PostgreSQL integration ایجاد کن.
5. هیچ‌کدام از این کارها را با گزارش صرف جایگزین نکن.

**قبولی:** baseline مستند در progress، build سبز، OpenAPI سبز، Prisma validate سبز، مسیر اجرای Jest/integration واقعی مشخص و فعال.

### Gate 1 — OpenAPI مالی Contract Lock (فقط قرارداد و contract validation)

ابتدا `contracts/openapi.yaml` را تکمیل کن، پیش از ساخت Controller مالی. قرارداد باید شامل حداقل این مسیرها/مدل‌ها باشد:

- Charge create/list/detail, monthly billing preview + post (manual; no scheduler), Credit/absence-credit.
- Payment create/list/detail; allocation create/list; allocation release; unallocated balance.
- Ledger reversal/Void; PaymentRefund.
- Deposit received/refund/forfeit/apply-to-charges.
- Expense create/list/reversal.
- Resident account buckets and statement with from/to dates.
- Receipt and provisional receipt mapping semantics.
- BillingRun preview/post idempotent flow.
- Error enums, permission matrix, idempotency replay/conflict, expectedVersion, sync behavior, date semantics.

همهٔ request/responseها، amount bounds، `AFN`, date fields، error codes، auth/role requirements و نمونه‌های JSON باید صریح باشند. `Money.amount` برای سند منفرد integer است. Aggregateهای ممکن است بزرگ‌تر از safe integer باشند به‌صورت decimal integer string تعریف شوند.

**قبولی:** Redocly lint/validate سبز؛ semantic contract review با schema/DTOهای هدف؛ contract tests یا schema checks؛ هیچ Controller یا migration مالی هنوز ساخته نشود.

### M-1 — Date + Amount + Contract Checkout

1. helper یکتای تاریخ برای `inclusive last occupied day → exclusive end` بساز.
2. `AssignmentsService.end()` و `ContractsService` را اصلاح کن تا Checkout در روز شروع معتبر باشد و end=`D+1` ذخیره شود.
3. Transfer همچنان old.end=`transitionStart`, new.start=`transitionStart`؛ بدون `+1`.
4. قرارداد ACTIVE فقط از مسیر Checkout اتمیک پایان یابد؛ قرارداد و همهٔ assignmentهای ACTIVE در همان transaction بسته شوند. DRAFT cancel شود.
5. برای رکوردهای جدید `BedAssignment.endReason` اجباری در service باشد؛ برای legacy nullable باقی بماند و مقدارهای قدیمی را تغییر نده.
6. CHECK amount>0 و range constraints لازم در DB اضافه شوند؛ سقف int32 در DTO و DB enforce شود.
7. preflight legacy فقط گزارش و fail-fast بدهد؛ هیچ update خودکار تاریخ.

**تست‌های اجباری:** same-day stay، آخر ماه، عبور ماه، leap February، Transfer same day، double checkout race، checkout vs transfer race، legacy row unchanged، amounts 0/negative/>int32 rejected.

### M-2 — Composite Tenant + Resident Foreign Keys

1. تمام cross-tenant و cross-resident references فعلی را preflight کن.
2. روی referenced tables کلیدهای مرکب لازم اضافه کن، از جمله `(organizationId,id)` و در رابطه‌های Resident/Contract/Charge/Payment/TemporaryAbsence، `(organizationId,residentId,id)`.
3. `PaymentAllocation` باید `organizationId` و `residentId` داشته باشد و FK مرکب به Payment و Charge بگیرد.
4. `Charge → StayContract`, `TemporaryAbsence → Resident/StayContract`, `AbsenceCredit → TemporaryAbsence/Charge` و Deposit/Payment/Assignment/Room/Bed/Hostel/package relations باید تا حد لازم org/resident consistent شوند.
5. ستون nullable + backfill فقط از parent قابل اعتماد، سپس NOT NULL و FK swap در یک migration مرحله‌بندی‌شده. اگر preflight mismatch دارد، migration بدون mutate fail شود.
6. parent-child indexes ساخته شوند؛ onDelete policy موجود حفظ و بازبینی شود.
7. `LockService.lockForUpdate(tx, entity, id, organizationId)` برای org-scoped اجباری و `lockGlobal` فقط برای global rows باشد. تمام call sites اصلاح شوند.

**تست‌های اجباری:** cross-org FK reject؛ cross-resident same-org FK reject؛ missing parent reject؛ tenant A نتواند row tenant B را حتی lock کند؛ successful same-tenant references؛ migration empty DB و baseline DB.

### M-3a — Charge / Billing / Credit Engine

1. Charge service واقعی و DTO/Controller طبق Gate 1.
2. RENT requires contractId و unique partial index دقیق روی `(organization_id, contract_id, period_start, period_end) WHERE type='RENT' AND contract_id IS NOT NULL`.
3. BillingRun فقط manual preview → explicit post؛ no cron/automatic issuance در MVP. Retry همان run/period duplicate charge نسازد.
4. از contract packageSnapshot قیمت و اجزا را بخوان؛ نرخ جاری package نادیده گرفته شود.
5. prorating با `decimal.js`, integer AFN, half-up. Charge period نیمه‌باز. دوره‌های ماهانه ۲۸/۲۹/۳۰/۳۱ روز تست شوند.
6. Creditها با `entrySide=CREDIT`, positive amount و reason/actor ذخیره شوند. تخفیف voucher نیست؛ manual credit است.
7. Absence Credit فقط پس از actual return approved؛ minimum 3 days per hostel setting؛ first full absent day; accommodation excluded; eligible snapshot components only; split by calendar month; store component breakdown.
8. هر post در transaction واحد: domain record + idempotency + audit + sync change.

**تست‌های اجباری:** duplicate across two keys/workers، half-up boundaries، exact-month and partial-month, package snapshot immutability, no accommodation credit, absence < minimum, exact minimum, multi-month, actual return adjustment, no second credit same absence-period.

### M-3b — Payment / Allocation / Receipt

1. Payment create همیشه received amount positive و به Resident ثبت‌شده متصل باشد؛ payer fields optional. Method manual only.
2. ایجاد Payment و تخصیص آن use-caseهای جدا باشند؛ Payment در ابتدا Unapplied است. Allocation فقط صریح و user-selected.
3. official receipt number با `ReceiptCounter` سازمانی، بدون reset سالانه، gap مجاز، unique؛ در transaction موفق سرور ساخته شود.
4. Allocation و AllocationRelease append-only و atomic invariants طبق بخش 4.
5. payment/charge reversal, allocation release و payment state transitions باید قفل‌ها را به ترتیب canonical بگیرند.
6. یک Payment نباید به charge متعلق به Resident دیگر allocate شود؛ حتی داخل همان org.

**تست‌های اجباری:** allocation partial/full، amount over payment/charge، concurrent over-allocation، release race، second allocation after release، same payment-charge reuse، duplicate idempotency، payer third-party doesn't change debtor, official receipt unique & stable, no official receipt on offline client.

### M-3c — Deposit / Expense / Reversal / Refund

1. Deposit transactions append-only؛ balance formula طبق بخش 4.4.
2. partial/full refund; partial/full forfeit; explicit application to selected charges at checkout; all balance invariants concurrent-safe.
3. Deposit application creates internal Payment + Allocation and does not inflate cash received.
4. PaymentRefund is actual cash outflow and distinct from Void; only unallocated amount refund in MVP.
5. Void wrong Charge/Payment full only; release allocations first; create opposite-side positive LedgerReversal. No negative amount anywhere.
6. Expense is paid expense only; create and full reverse with reason/actor; no payables.
7. OWNER/ADMIN only for reversals, refunds/forfeits/deposit application/manual credits.

**تست‌های اجباری:** deposit over-refund/over-forfeit/over-apply rejected; partial deposit refund valid; deposit apply to selected charge only; deposit not counted as cash; refund > unallocated rejected; void allocated payment requires release; reversal direction opposite; no double neutralization; actor/role matrix.

### M-3d — Account / Statement / Audit / Sync

1. یک canonical balance calculator برای account buckets؛ UI/report/API محاسبهٔ مستقل نداشته باشند.
2. `Outstanding Receivable`, `Unapplied Payment/Credit`, `Deposit Held` جدا باشند.
3. Statement دارای opening/closing balances و رویدادهای مرتب‌شده با tie-breaker deterministic باشد؛ statement sum باید با account summary reconcile شود.
4. AuditEvent در همان transaction تغییر مالی ثبت شود؛ Actor، Organization، action، entity، before/after مجاز، reason، traceId، businessDate و server timestamp. شکست audit باعث rollback شود.
5. SyncChange همان transaction mutation ثبت شود؛ cursor sequence سازمانی commit-ordered بماند.
6. queueable mutations با retention دائمی سبک IdempotencyRecord؛ request hash mismatch → 409؛ replay → همان resource/result reference.
7. Offline provisional receipt semantics در schema قرارداد روشن شود. هیچ server endpoint نباید client local ID را به‌عنوان DB foreign key بپذیرد؛ client mapping/dependency strategy در بخش 5 رعایت شود.
8. Trial/plan expiry نباید سوابق، read/export یا settle کردن حساب Residentهای موجود را نابود/کورکورانه مسدود کند.

**تست‌های اجباری:** statement reconcile، opening/closing period boundaries، reversed docs, refund, deposit separation, cursor no-skip under concurrent commits, tombstone, stale cursor resync, idempotency after >30 days simulation, entitlement expired but existing resident payment sync accepted, no cross-tenant sync leak.

### M-4 — Release Gate

- Build, lint, OpenAPI, Prisma validate/generate, migrations on empty DB and baseline DB, Jest unit, PostgreSQL integration, contract/security/concurrency/sync/reconciliation suites all run in CI.
- Smoke suite واقعی HTTP + final DB assertions برای تمام جریان‌های مالی.
- `npm audit`/dependency checks طبق tooling موجود؛ بدون ارتقای بی‌دلیل نسخه‌ها.
- Backup/restore دستورها در محیط توسعه آزموده شوند؛ قبل از pilot واقعی restore واقعی DB انجام شود.
- هیچ TODO/placeholder در مسیرهای مالی اصلی باقی نماند.
- Release Candidate فقط با صفر P0/P1 باز و تست‌های mandatory سبز؛ هر شکست دقیق گزارش شود، نه پنهان.

## 9. قرارداد قفل و رفتار عامل کدنویس

- مستقیم از آخرین `origin/main` (commit `41af931e8be5ef194670989cae603c6cb1c51eca`) شروع کن و به commitهای تاریخی reset یا overwrite نکن.
- branch جدا بساز و تغییرات را در commitهای کوچک Gate-based تحویل بده؛ force push ممنوع.
- برای هر Gate، اول کد و تست را پیاده کن؛ فقط فایل‌های ضروری مثل `progress.md` را به‌روزرسانی کن. فایل تحلیل جدید یا نسخهٔ تازهٔ طرح نساز، مگر واقعاً برای اجرای کد ضرورت داشته باشد.
- از ایجاد معماری اضافه، event bus، CQRS کامل، Redis، Kafka، microservices یا abstraction غیرضروری خودداری کن.
- migrationها additive و non-destructive باشند؛ دادهٔ قدیمی حذف، rewrite یا حدس‌زده نشود.
- تست race باید با barrier واقعی و PostgreSQL باشد، نه صرفاً `Promise.all` بدون کنترل هم‌زمانی.
- در هر گزارش فقط: commit، فایل‌های اجرایی تغییرکرده، دستورات واقعاً اجراشده، تعداد PASS/FAIL/SKIP، migration status و مانع واقعی را بنویس.
- بعد از پایان هر Gate، خودت Gate بعد را شروع کن؛ برای «تأیید طراحی»، «تصویب Dها» یا «اجازهٔ ادامه» متوقف نشو.
- فقط اگر تغییر مخرب/غیرقابل‌بازگشت روی دادهٔ واقعی لازم می‌شود، یا امنیت/قانون/سازگاری فنی مانع قطعی است، عملیات را متوقف و خطر را مشخص کن. در غیر این صورت تصمیم این سند اجرا شود.

## 10. تعریف Done فاز ۹

فاز ۹ فقط وقتی Done است که تمام جریان زیر روی PostgreSQL واقعی و API واقعی موفق و قابل reconciliation باشد:

1. ساخت سازمان/لیلیه/Resident/Package/Contract و Assignment؛
2. پیش‌نمایش و صدور idempotent کرایهٔ ماهانه؛
3. absence چندروزه/چندماهه و Credit معتبر پس از بازگشت؛
4. ثبت Payment نقدی/انتقال/موبایل‌مانی دستی و صدور Receipt رسمی؛
5. ثبت و release تخصیص‌های جزئی، race-safe؛
6. Void کامل و Refund واقعی با تفکیک Cash flow؛
7. دریافت/Refund/Forfeit/Apply ودیعه با ماندهٔ درست و جدا از کرایه؛
8. ثبت Expense پرداخت‌شده و reversal؛
9. Statement و account buckets که با اسناد اصلی reconcile شوند؛
10. audit و sync events اتمیک؛
11. retry آفلاین همان mutation بدون duplicate، 409 روشن برای conflict، cursor بدون skip؛
12. tenant/resident FK integrity، permissions و CI سبز.

**دستور نهایی:** فاز ۹ را اجرا کن؛ تصمیم‌های این سند را دوباره به مالک ارجاع نده؛ صرفاً مستندات تحویل نده.
