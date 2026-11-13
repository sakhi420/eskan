# دستور اجرایی عامل برنامه‌نویسی — اصلاح و پذیرش فاز M3c اسکان

**شناسه:** ESKAN-M3C-REMEDIATION-AND-ACCEPTANCE-v1.0  
**مخزن:** `sakhi420/eskan`  
**شاخهٔ مورد انتظار:** `feat/m3c-deposit-expense-refund-reversal`  
**مبنای گزارش‌شده:** `506947b2ac6f475f5c9418dfb640af5c9719bb10`  
**سرِ شاخهٔ گزارش‌شده:** `2409f0622f723d3b5bb4b465a1241f4aba7118f5`  
**دامنه:** اصلاح، آزمون، مستندسازی و آماده‌سازی پذیرش M3c؛ نه پیاده‌سازی M3d و نه ساخت فرانت‌اند.

---

## ۱. مأموریت و نتیجهٔ مورد انتظار

تو عامل ارشد مهندسی بک‌اند پروژهٔ ESKAN هستی. مأموریت تو این است که پیاده‌سازی M3c را در شاخهٔ مربوط بررسی و اصلاح کنی تا جریان‌های **ودیعه، بازپرداخت، مصادره، اعمال ودیعه، هزینه، برگشت کامل اسناد مالی، Audit، Sync، Idempotency و Reconciliation** با تصمیم‌های قطعی پروژه سازگار و قابل‌آزمون شوند.

این مأموریت صرفاً یک بازبینی یا نوشتن گزارش نیست. باید ایرادهای قابل‌اصلاح را در کد، schema، migration، API contract و تست‌ها رفع کنی؛ سپس شواهد واقعی اجرا را ثبت کنی. گزارش موفقیت بدون اجرای فرمان و مشاهدهٔ خروجی واقعی ممنوع است.

**وضعیت اولیه را قبول‌شده فرض نکن.** گزارش قبلی M3c می‌گوید بعضی تست‌ها پاس شده‌اند، اما بازبینی کد موارد بحرانی پیدا کرده و تعداد تست‌های اعلام‌شده نیز با تعداد تست‌های موجود در فایل‌ها تطبیق کامل ندارد. ابتدا وضعیت فعلی Git، کد و تست را دوباره بررسی کن.

### تعریف موفقیت

M3c فقط زمانی آمادهٔ پذیرش است که:

1. هر سه مانع P0 این سند رفع شده و برای هرکدام تست بازتولیدکنندهٔ خطا وجود داشته باشد.
2. همهٔ موارد P1 رفع شده یا با دلیل فنی روشن و ارجاع به تصمیم قطعی مالک محصول، به‌عنوان مانع باز ثبت شده باشند. مورد P1 مالی/امنیتی را بی‌اجازه به P2 تنزل نده.
3. قرارداد OpenAPI، DTO، سرویس، schema و رفتار HTTP با هم یکسان باشند.
4. تمام mutationهای مالی وابسته، در یک transaction اتمیک شامل تغییر داده، Audit، SyncChange و Idempotency ثبت شوند.
5. آزمون‌های نقش‌ها، جداسازی سازمان، رقابت هم‌زمان و Reconciliation مستقل پاس شوند.
6. migration هم روی پایگاه دادهٔ خالی و هم روی clone از baseline پشتیبانی‌شده آزمایش شود.
7. CI خروجی قابل‌تشخیص داشته باشد و شکست را به یک وضعیت مبهم `failed` محدود نکند.
8. گزارش نهایی فقط نتایج واقعاً اجراشده را اعلام کند.

---

## ۲. مرجع حقیقت و ترتیب تقدم اسناد

پیش از تغییر کد، این فایل‌ها را در شاخهٔ جاری بخوان:

1. `ESKAN_PHASE9_EXECUTION_DIRECTIVE_v1_FA.md` — **مرجع اجرایی و تصمیم‌های قفل‌شدهٔ فاز ۹**.
2. `docs/architecture/decisions/ADR-0011-m3c-deposit-refund-expense-reversal.md` — تصمیم معماری M3c؛ هر تعارض آن با دستور فاز ۹ باید اصلاح و مستند شود.
3. `prisma/schema.prisma` و migrationهای مرتبط.
4. `contracts/openapi.yaml`، DTOها، Controllerها و سرویس‌های مربوط.
5. تست‌های unit/integration و اسناد `docs/project/progress.md`.
6. `ESKAN_Phase9_Engineering_Readiness_Audit_v0.1_FA.md` و `ESKAN_BACKEND_MASTER_PROMPT_NESTJS_FA_v3.md` به‌عنوان اسناد زمینه‌ای و قدیمی‌تر.

### تقدم و حل تعارض

- دستور اجرایی جدید فاز ۹ و تصمیم‌های صریح مالک محصول، بر اسناد قدیمی‌تر و متن‌های تاریخی مقدم‌اند.
- کد موجود «شاهد رفتار فعلی» است، نه مرجع تعریف قانون کسب‌وکار.
- ADR-0011 باید با دستور فاز ۹ هماهنگ شود؛ ADR نمی‌تواند تصمیم قفل‌شده را بی‌صدا تغییر دهد.
- در اسناد قدیمی‌تر ممکن است پول با `NUMERIC(19,2)` تعریف شده باشد. تصمیم جدیدتر A-016 و دستور اجرایی فعلی، مبلغ را **عدد صحیح AFN** تعریف می‌کند. هنگام اصلاح M3c، مدل `Int`/AFN را حفظ کن و آن را به اعشار یا ارزهای چندگانه برنگردان.
- از ساخت قابلیت‌های خارج از دامنه یا بازکردن تصمیم‌های بسته‌شده خودداری کن.
- اگر دو سند فعال و هم‌سطح واقعاً متناقض‌اند و انتخاب یکی اثر مالی یا امنیتی دارد، آن بخش را متوقف کن، تعارض را با نقل نام فایل/بخش و پیامد دقیق ثبت کن و تصمیم لازم را به مالک گزارش بده. خودسرانه قانون تازه نساز.

### تصمیم‌های قطعی که باید رعایت شوند

- **D-02:** برگشت سند اشتباه، برگشت کامل سند است؛ برگشت وجه واقعی یک رویداد جداست؛ اصلاحات با مبالغ مثبت و جهت Debit/Credit انجام می‌شوند، نه با مبلغ منفی یا پاک‌کردن تاریخچه.
- **D-08:** مجموع refund، forfeit و apply نباید از ودیعهٔ معتبر دریافت‌شده بیشتر شود.
- **D-09:** مصادرهٔ ودیعه خودکار نیست؛ دلیل و Actor الزامی است و فقط OWNER/ADMIN مجازند.
- **D-10:** اعمال ودیعه فقط هنگام تسویه/Checkout نهایی، برای Charge(های) انتخاب‌شده و با مبلغ مشخص مجاز است؛ فقط OWNER/ADMIN. عملیات باید اتمیک باشد و Payment داخلی `DEPOSIT_APPLICATION` همراه Allocation بسازد؛ این عملیات دریافت نقدی جدید نیست.
- **D-14:** Expense فقط هزینه‌ای است که واقعاً پرداخت شده؛ حساب پرداختنی/AP در این دامنه نیست.
- **D-15:** در Statement باید سه سرفصل جدا نمایش داده شوند: `Outstanding Receivable`، `Unapplied Payment/Credit` و `Deposit Held`.
- **D-16:** روش‌های پرداخت دستی مجاز: `CASH`، `BANK_TRANSFER`، `MOBILE_MONEY`، `OTHER`. درگاه پرداخت آنلاین در این کار ایجاد نکن.
- **D-18:** حذف فیزیکی اسناد مالی ممنوع؛ دلیل، Actor، زمان سرور، businessDate و Audit لازم‌اند. فقط OWNER/ADMIN مجاز به reversal، refund، forfeit، apply و adjustment هستند. OPERATOR فقط عملیات روزمرهٔ مجاز مانند ثبت عادی Payment، Deposit Receipt و Expense را انجام می‌دهد؛ VIEWER فقط خواندن دارد.

---

## ۳. خط پایه و ایمنی Git — پیش از هر ویرایش

این مراحل را به‌ترتیب اجرا کن:

1. `pwd`، `git status --short --branch`، `git branch --show-current`، `git log -5 --oneline --decorate` و `git remote -v` را اجرا و خروجی را ثبت کن.
2. وجود branch مورد انتظار و commit فعلی را بررسی کن. شاخه ممکن است از آخرین گزارش تغییر کرده باشد؛ SHAهای بالا را حقیقت فعلی فرض نکن.
3. `git status` را با دقت بررسی کن. اگر تغییرات کاربر یا تغییرات ناشناخته وجود دارد، آن‌ها را حفظ کن؛ reset، checkout مخرب، clean، stash اجباری یا حذف فایل انجام نده.
4. HEAD شاخهٔ M3c را با `main` مقایسه کن. اگر branch وجود ندارد، تغییرات روی `main` نساز؛ وضعیت را گزارش کن و از مالک اجازهٔ ساخت branch جدید بگیر.
5. هیچ commit موجودی را amend نکن، تاریخچه را rewrite نکن و force-push نکن.
6. پیش از اصلاح، build، lint، OpenAPI lint، Prisma validation و تست‌های مرتبط را اجرا کن تا خطاهای قبلی از خطاهای جدید جدا شوند.
7. گزارش قبلی می‌گوید شاخهٔ M3c یک commit جلوتر از `main` بوده و هنوز PR واقعی ساخته نشده بود؛ لینک `/pull/new/...` فقط مسیر ایجاد PR است، نه شناسهٔ PR. وضعیت PR و CI را در GitHub دوباره بررسی کن و فرض قبلی را تکرار نکن.
8. اگر دسترسی GitHub در دسترس است، وضعیت branch، PR و workflow را با SHA دقیق ثبت کن. از روی نبودن صفحهٔ CI نتیجه نگیر که تست پاس شده است.

**ممنوع:** اجرای migration M3c روی `eskan_dev`، Staging یا Production در این مأموریت. M3c فقط باید روی PostgreSQL موقت/دورریختنی و clone آزمایشی اجرا شود. دادهٔ واقعی یا محیطی که ممکن است دادهٔ کاربر داشته باشد، محل rehearsal نیست.

---

## ۴. اصلاحات P0 — مانع قطعی پذیرش

### P0-1 — کسر نشدن PaymentRefund از موجودی قابل تخصیص Payment

**محل بررسی اولیه:**

- `src/payments/payments.service.ts`
- تابع `unappliedBalance()` در محدودهٔ قبلی خطوط 259–271
- مسیر `createAllocation()` در محدودهٔ قبلی خطوط 517–524
- مسیر `refundPayment()` در محدودهٔ قبلی خطوط 661–701

**اشکال بازبینی‌شده:**

تابع `unappliedBalance()` مبلغ Payment را پس از کسر Allocation و افزودن Release محاسبه می‌کند، اما Refundهای قبلی را کم نمی‌کند. از طرف دیگر `refundPayment()` مبلغ refund را جداگانه کنترل می‌کند. در نتیجه یک Payment ممکن است پس از بازپرداخت بخشی از پولش، دوباره بیش از وجه باقی‌مانده تخصیص داده شود.

**الزام اصلاح:**

1. یک فرمول canonical برای ماندهٔ قابل‌استفادهٔ Payment تعریف کن و تمام مسیرهای `allocate`، `refund`، `reverse` و replay از همان منبع استفاده کنند.
2. فرمول باید با وضعیت و رویدادهای معتبر سازگار باشد؛ حداقل اثر اقتصادی Allocation، AllocationRelease و PaymentRefund را دقیقاً یک‌بار لحاظ کند.
3. از کسر دوبارهٔ Refund در `refundPayment()` جلوگیری کن. اصلاح فرمول نباید باعث شود Refund دوبار از مانده کم شود.
4. Payment reversed، refund کامل، allocation آزادشده و ترکیب این رویدادها باید قواعد صریح داشته باشند؛ منطق را صرفاً با جمع سادهٔ همهٔ رکوردها نساز، وضعیت اعتبار هر رویداد را لحاظ کن.
5. در transaction و پس از قفل لازم، مانده را دوباره بخوان و کنترل کن؛ چک قبل از قفل کافی نیست.

**تست الزامی بازتولید خطا:**

- Payment به مبلغ 10,000 AFN ایجاد شود.
- Refund به مبلغ 4,000 AFN انجام شود.
- تخصیص 10,000 AFN باید رد شود.
- تخصیص حداکثر 6,000 AFN باید با توجه به وضعیت سایر رویدادها مجاز باشد.
- Refund بیش از مبلغ واقعاً تخصیص‌نیافته باید رد شود.
- سناریوهای allocation → release → refund و refund → allocation و retry هم‌زمان نیز تست شوند.
- نتیجهٔ مانده باید با Oracle مستقل مبتنی بر رکوردهای خام برابر باشد.

### P0-2 — جلوگیری از جعل `DEPOSIT_APPLICATION` در مسیر عادی Payment

**محل بررسی اولیه:**

- `src/payments/payments.service.ts`، `createPayment()` در محدودهٔ قبلی خطوط 316–360
- Controller و DTO ثبت Payment
- `contracts/openapi.yaml`، `PaymentRequest` و enum `PaymentMethod`

**اشکال بازبینی‌شده:**

نوع داخلی `DEPOSIT_APPLICATION` در enum عمومی Payment قابل ارسال است. مسیر عادی Payment آن را رد نمی‌کند و شمارهٔ رسید را نیز بدون تمایز ایجاد می‌کند. این کار می‌تواند توسط OPERATOR به‌عنوان پرداخت ظاهراً عادی استفاده شود و بدهی ساکن را بدون دریافت پول واقعی کاهش دهد؛ همچنین قید D-10 را دور می‌زند.

**الزام اصلاح:**

1. enum عمومی ورودی Payment فقط این روش‌ها را بپذیرد: `CASH`، `BANK_TRANSFER`، `MOBILE_MONEY`، `OTHER`.
2. `DEPOSIT_APPLICATION` فقط نوع داخلی باشد و از DTO و مسیر عمومی ثبت Payment قابل انتخاب نباشد.
3. سرویس نیز به‌صورت دفاع چندلایه آن را رد کند؛ صرف محدودکردن OpenAPI یا DTO کافی نیست.
4. مسیر ویژهٔ `DepositApplication` تنها مسیر ایجاد DAPP باشد و مجوز OWNER/ADMIN و کنترل Checkout نهایی را اجرا کند.
5. DAPP نباید شمارهٔ رسید نقدی/دریافت وجه داشته باشد و نباید Receipt Counter را مصرف کند.
6. در سطح DB نیز قید سازگار اضافه کن تا DAPP نتواند receipt_number غیرتهی داشته باشد؛ قید باید با داده و schema موجود سازگار و migration-safe باشد.
7. OpenAPI باید enum مخصوص ورودی عمومی را از enum داخلی دیتابیس جدا کند. توضیح متنی «این مقدار فقط داخلی است» جای قید اجرایی را نمی‌گیرد.

**تست‌های الزامی:**

- درخواست HTTP عادی با `method=DEPOSIT_APPLICATION` باید رد شود.
- فراخوانی مستقیم سرویس عادی با DAPP باید رد شود.
- OPERATOR نتواند endpoint ویژهٔ apply را فراخوانی کند.
- ثبت عادی چهار روش مجاز همچنان کار کند.
- DAPP ساخته‌شده از مسیر مجاز، receipt_number نداشته و Receipt Counter را تغییر ندهد.
- قید دیتابیس با درج مستقیم رکورد نامعتبر نیز آزمایش شود.

### P0-3 — برگشت DAPP باید Deposit Held و Charge را با هم و دقیقاً یک‌بار اصلاح کند

**محل بررسی اولیه:**

- `src/deposits/deposits.service.ts`، مسیر `apply()` در محدودهٔ قبلی خطوط 305–386
- `src/payments/payments.service.ts`، مسیر `reversePayment()` در محدودهٔ قبلی خطوط 716–772
- محاسبهٔ `residentHeld()` و هر query مرتبط با DepositApplication

**اشکال بازبینی‌شده:**

`apply()` یک Payment داخلی DAPP و Allocation ایجاد می‌کند. `reversePayment()` عمومی می‌تواند Payment را reverse کند و Allocation را آزاد سازد، اما DepositApplication را خنثی نمی‌کند. در نتیجه بدهی Charge دوباره باز می‌شود، ولی ودیعه همچنان مصرف‌شده حساب می‌شود. همچنین مسیر refund عمومی نباید بتواند DAPP را مانند پول نقد مسترد کند.

**الزام اصلاح:**

1. جریان DAPP را به‌عنوان یک عملیات مالی واحد مدل کن؛ رابطهٔ DepositApplication، Payment و PaymentAllocation باید ساختاری و قابل query باشد، نه فقط در JSON مربوط به Audit.
2. برگشت کامل DAPP باید از مسیر اختصاصی و مجاز انجام شود و در یک transaction اتمیک:
   - Payment داخلی را به شکل قانونی و کامل reverse کند؛
   - Allocation مرتبط را آزاد/خنثی کند؛
   - مصرف ودیعه را با رویداد جبرانی append-only به ماندهٔ معتبر ودیعه برگرداند؛
   - LedgerReversalهای لازم را با جهت درست ثبت کند؛
   - AuditEvent و SyncChange تمام موجودیت‌های تغییرکرده را درج کند؛
   - کل عملیات را با Idempotency-Key محافظت کند.
3. برگشت باید کامل باشد، نه برگشت جزئی مخفی یا تغییر خاموش مبلغ سند اصلی؛ با D-02 تطبیق داشته باشد.
4. DAPP به‌هیچ‌وجه نباید از مسیر `PaymentRefund` به‌عنوان refund نقدی برگشت بخورد؛ refund نقدی فقط برای وجهی مجاز است که واقعاً دریافت شده و طبق دستور فاز ۹ واجد شرایط است.
5. جلوگیری از double neutralization الزامی است: یک DAPP نباید هم با LedgerReversal و هم با رویداد جبرانی دیگری دو بار به Deposit Held اضافه شود.
6. اگر ساختار کنونی برای نمایش برگشت DAPP کافی نیست، کمینهٔ تغییر schema و migration لازم را طراحی کن؛ ADR-0011 را به‌روزرسانی کن و دلیل رابطه‌ها و اثر حسابی را توضیح بده. مسیر ساده اما نادرست را به‌عنوان workaround انتخاب نکن.
7. همهٔ endpointهای عمومی `reversePayment` و `refundPayment` باید نوع DAPP را بشناسند و مسیر نامعتبر را رد کنند؛ صرف پنهان‌کردن دکمه در کلاینت ممنوع است.

**تست‌های الزامی:**

- دریافت ودیعه 10,000 AFN؛ اعمال 4,000 AFN به Charge؛ سپس برگشت کامل DAPP: Deposit Held باید به مقدار پیش از apply برگردد و بدهی Charge نیز دقیقاً یک بار باز شود.
- اجرای دوبارهٔ همان درخواست reversal با همان key باید همان نتیجهٔ منطقی را بازگرداند.
- دو درخواست هم‌زمان reversal نباید دوبار ودیعه را برگردانند.
- refund نقدی روی DAPP باید رد شود.
- reversal عادی Payment نقدی همچنان رفتار درست خود را حفظ کند.
- SQL reconciliation بعد از apply و reversal، مبلغ Deposit Held و Charge Outstanding را مستقل تأیید کند.

---

## ۵. اصلاحات P1 — یکپارچگی مالی، Sync و امنیت

### P1-1 — ماندهٔ هر ودیعه و پیوند رویدادهای آن

**اشکال بازبینی‌شده:**

محاسبهٔ فعلی `residentHeld()` مانده را در سطح Resident جمع می‌کند، اما refund/forfeit/apply ظاهراً یک DepositTransaction مشخص را هدف می‌گیرند. برای refund و forfeit شناسهٔ منبع فقط در `AuditEvent.after` دیده می‌شود، نه در یک رابطهٔ ساختاری. مسیر apply نیز همهٔ refund و forfeitهای قبلی همان ودیعه را به‌درستی از مبلغ باقی‌مانده کم نمی‌کند. نمونهٔ ثبت‌شده: دریافت 100,000، بازپرداخت 20,000، مصادره 10,000 و اعمال 5,000؛ Held برابر 65,000 است، اما پاسخ apply قبلاً 95,000 برمی‌گرداند.

**الزام اصلاح:**

1. قرارداد API و معنای شناسهٔ ورودی را بررسی کن. تا وقتی endpoint یک DepositTransaction مشخص را هدف می‌گیرد، محاسبه باید source-specific باشد؛ بدون تأیید مالک محصول آن را به مدل pooled در سطح Resident تبدیل نکن.
2. برای refund و forfeit، شناسهٔ DepositTransaction منبع را در یک ستون/رابطهٔ صریح ذخیره کن؛ اتکا به JSON در Audit برای محاسبهٔ مانده کافی نیست.
3. `DepositApplication` نیز باید به منبع DepositTransaction مشخص متصل بماند.
4. منبع باید از نظر organization، resident، contract (در صورت وجود)، type و status معتبر باشد. منبع reversed یا نامعتبر نباید دوباره برای refund/forfeit/apply مصرف شود.
5. ماندهٔ هر منبع از RECEIVED معتبر همان منبع، منهای REFUNDED، FORFEITED، APPLIED و با لحاظ reversalهای معتبر محاسبه شود.
6. `Refunded + Forfeited + Applied` هرگز از Received معتبر همان ودیعه بیشتر نشود؛ در صورت وجود قواعد قراردادی دیگر، آن‌ها نیز enforce شوند.
7. محاسبه، کنترل سقف و درج رویدادها باید در transaction و زیر قفل صحیح انجام شوند؛ read-then-write بدون قفل کافی نیست.
8. فیلد `remainingDepositBalance` در response باید به همان منبعی اشاره کند که request انتخاب کرده است و با SQL مستقل برابر باشد.
9. تمام روابط Deposit باید از نظر چندسازمانی و ساکن/قرارداد معتبر باشند؛ هیچ رویداد متعلق به Resident یا Organization دیگر قابل مصرف نباشد.

**تست‌ها:** refund/forfeit/apply جزئی و کامل؛ over-refund؛ over-forfeit؛ over-apply؛ ترکیب هر سه؛ منبع reversed؛ منبع با وضعیت نامعتبر؛ دو منبع ودیعه برای یک Resident؛ دو قرارداد تاریخی؛ race بین دو apply یا refund/forfeit/apply؛ پاسخ balance و SQL oracle.

### P1-2 — ثبت SyncChange برای تمام اثرهای وابستهٔ mutation

**اشکال بازبینی‌شده:**

- `DepositsService.apply()` یک `PaymentAllocation` می‌سازد اما SyncChange متناظر Allocation را ثبت نمی‌کند.
- `PaymentsService.reversePayment()` یک یا چند `AllocationRelease` ایجاد و Chargeهای مربوط را تغییر می‌دهد، اما SyncChange مربوط به `ALLOCATION_RELEASE` و Chargeهای تغییرکرده را ثبت نمی‌کند.

**الزام اصلاح:**

1. برای هر mutation، تمام entityهایی را که داده یا version آن‌ها تغییر کرده فهرست کن.
2. برای هر entity قابل Sync، Change مناسب (از جمله DepositApplication، Payment، Allocation، AllocationRelease، Charge، LedgerReversal، DepositTransaction و Expense در مسیرهای مربوط) در همان transaction درج شود.
3. حذف یا تغییر وضعیت را مطابق قرارداد Sync موجود به UPSERT/TOMBSTONE یا action مصوب تبدیل کن؛ نوع جدید دلخواه نساز.
4. ترتیب sequence و tenant scope را با معماری Sync موجود حفظ کن.
5. اگر هر SyncChange شکست خورد، کل عملیات مالی باید rollback شود؛ موفقیت مالی بدون ثبت Sync مجاز نیست.
6. Audit و Sync را جایگزین یکدیگر نکن؛ هر دو وظیفهٔ جدا دارند.

**تست‌ها:** برای هر عملیات، موجودیت‌های تغییرکرده با SyncChangeها تطبیق داده شوند؛ failure اجباری در درج Sync باید transaction را rollback کند؛ Tenant دیگر هیچ رویدادی نبیند.

### P1-3 — تعریف و آزمون جهت LedgerReversal

**اشکال بازبینی‌شده:**

دستور فاز ۹ و قرارداد LedgerReversal می‌گویند جهت reversal باید مخالف جهت ثبت اصلی باشد (`DEBIT ↔ CREDIT`). در پیاده‌سازی و ADR-0011 برای بعضی sourceها مقدار ثابت ثبت شده است: Charge از `entrySide` مخالف می‌گیرد، Payment برابر CREDIT، Deposit برابر CREDIT و Expense برابر DEBIT. این نگاشت بدون اثبات جهت ثبت اصلی هر source قابل قبول نیست؛ Deposit نیز چند نوع رویداد با اثر اقتصادی متفاوت دارد.

**الزام اصلاح:**

1. جهت ثبت اصلی هر source/event را از منطق واقعی posting، قرارداد و فرمول مانده استخراج کن.
2. یک mapping صریح و مستند برای هر نوع سند و هر نوع رویداد لازم ایجاد کن؛ mapping نباید با حدس یا صرف نام مدل تعیین شود.
3. جهت reversal را دقیقاً مخالف posting اصلی همان رویداد تعیین کن.
4. برای Deposit، دریافت، refund، forfeit و application را بدون تحلیل یک نوع واحد فرض نکن.
5. ADR-0011 را به‌روزرسانی کن و نگاشت source → original side → reversal side را جدول‌بندی کن.
6. تست هر source باید `side` را assert کند، نه فقط وجود رکورد LedgerReversal را.
7. Reversal نباید باعث خنثی‌سازی دوباره از مسیر status، release و ledger هم‌زمان شود.

**تست‌ها:** Charge، Payment نقدی، Deposit RECEIVED/REFUNDED/FORFEITED و DAPP، Expense؛ هر مورد جهت مخالف، مبلغ مثبت، ارتباط source و اثر نهایی balance را assert کند.

### P1-4 — پیوند ساختاری DepositApplication با Payment و Allocation

**اشکال بازبینی‌شده:**

DepositApplication دارای پیوند به DepositTransaction و Charge است، اما Payment و PaymentAllocation ساخته‌شده را فقط در Audit JSON می‌توان یافت. این برای query، reconciliation، Sync و reversal پایدار کافی نیست.

**الزام اصلاح:**

1. DepositApplication را به Payment تولیدشده و Allocation تولیدشده با FKهای واقعی متصل کن.
2. روابط باید tenant-scoped و در صورت امکان با composite FKهای متناسب با schema موجود حفاظت شوند.
3. response API باید شناسه‌های ساختاری مفید را برگرداند؛ قرارداد OpenAPI را هماهنگ کن.
4. تضمین کن هر DAPP دقیقاً به Payment و Allocation درست اشاره کند و Payment/Allocation تصادفی یا متعلق به سازمان/ساکن دیگر پذیرفته نشود.
5. اگر رابطهٔ یک‌به‌یک لازم است، UNIQUE constraint واقعی اضافه کن.
6. برای reversal DAPP، همین روابط باید مرجع اصلی پیدا کردن اسناد وابسته باشند؛ جست‌وجوی Audit JSON تنها راه ارتباطی نباشد.

### P1-5 — Idempotency replay باید پاسخ همان عملیات را بازگرداند

**اشکال بازبینی‌شده:**

- پاسخ اولین `reversePayment()` فقط Releaseهای ساخته‌شده در همان عملیات را برمی‌گرداند، اما `fromRecord()` قبلاً همهٔ AllocationReleaseهای وابسته به Payment را می‌خواند؛ اگر پیش از reverse آزادسازی جزئی وجود داشته باشد، replay نتیجه‌ای متفاوت می‌دهد.
- `DepositService.apply()` ممکن است در replay، `remainingDepositBalance` را با وضعیت فعلی جدول دوباره بسازد؛ پس پس از refund/forfeit بعدی، پاسخ replay با پاسخ اولیه یکی نیست.

**الزام اصلاح:**

1. همان key و همان request باید همان نتیجهٔ منطقی و همان شناسه‌های ایجادشده توسط همان operation را برگرداند.
2. نتیجه را به‌صورت snapshot پاسخ/شناسه‌های eventهای ایجادشده یا operation-result ساختاریافته ذخیره کن.
3. replay نباید Releaseهای قدیمی یا رویدادهای عملیات بعدی را به پاسخ اول اضافه کند.
4. فیلدهای محاسباتی پاسخ مانند remaining balance در زمان commit عملیات ثبت شوند و replay از وضعیت آتی دوباره محاسبه نشود.
5. همان key با body متفاوت باید Conflict استاندارد موجود را بدهد.
6. اگر response snapshot شامل دادهٔ حساس است، همان قواعد PII-safe replay فعلی را رعایت کن.
7. برای apply، payment reverse، payment refund و expense reversal، replay پس از ایجاد عملیات بعدی نیز باید پایدار بماند.

### P1-6 — کنترل واقعی Checkout نهایی برای D-10

**اشکال بازبینی‌شده:**

گارد قبلی تنها وجود قرارداد ACTIVE را بررسی می‌کند. این شرط می‌تواند Resident فاقد قرارداد یا دارای قرارداد DRAFT/وضعیت غیرنهایی را نیز از گارد عبور دهد. نبود قرارداد ACTIVE به‌تنهایی مدرک «Checkout نهایی» نیست.

**الزام اصلاح:**

1. مسیر apply باید به قرارداد/اقامت مربوط و وضعیت نهایی آن متصل باشد.
2. حداقل وجود قرارداد معتبر و بسته‌شده/خاتمه‌یافتهٔ مربوط باید اثبات شود؛ قرارداد DRAFT، Resident بدون قرارداد یا اقامت دارای Assignment فعال نباید صرفاً به‌دلیل نبود قرارداد ACTIVE واجد شرایط تلقی شود.
3. کنترل باید با مدل واقعی `StayContract` و `BedAssignment` تطبیق داده شود؛ نام فیلد یا وضعیت جدید اختراع نکن.
4. اگر schema فعلی واقعاً مفهوم Checkout نهایی را قابل اثبات نمی‌کند، محدودیت را در ADR ثبت کن و کمینهٔ راهکار schema را پیشنهاد بده؛ تا پیش از اثبات شرط، apply را fail-closed نگه دار.
5. ودیعهٔ قرارداد A نباید هنگام Checkout قرارداد B مصرف شود، مگر دستور محصول صریحاً مدل pooled را تأیید کرده باشد.

**تست‌ها:** بدون قرارداد؛ قرارداد DRAFT؛ قرارداد ACTIVE؛ قرارداد CLOSED/TERMINATED معتبر؛ Assignment فعال؛ چند قرارداد تاریخی؛ Deposit متعلق به قرارداد دیگر.

### P1-7 — تست HTTP برای نقش‌ها و جداسازی سازمان

تست‌های فعلی M3c عمدتاً سرویس را مستقیم صدا می‌زنند؛ این به‌تنهایی اثبات نمی‌کند guardها و Controllerها درست‌اند.

حداقل ماتریس زیر را در لایهٔ HTTP/API پیاده کن:

| عملیات | OWNER | ADMIN | OPERATOR | VIEWER |
|---|---:|---:|---:|---:|
| ثبت عادی Payment با روش مجاز | مجاز | مجاز | مجاز | رد |
| ثبت Deposit Receipt عادی | مجاز | مجاز | مجاز | رد |
| ثبت Expense پرداخت‌شده | مجاز | مجاز | مجاز | رد |
| Payment Allocation عادی، طبق مجوز endpoint فعلی | مطابق قرارداد | مطابق قرارداد | مطابق قرارداد | رد |
| Deposit refund | مجاز | مجاز | رد | رد |
| Deposit forfeit | مجاز | مجاز | رد | رد |
| Deposit application | مجاز | مجاز | رد | رد |
| Payment/Charge/Deposit/Expense reversal | مجاز | مجاز | رد | رد |

- هر اختلاف با ماتریس نهایی D-18 را از دستور فاز ۹ استخراج کن؛ جدول بالا مبنای تست است، نه اجازه برای تغییر سیاست.
- BOLA/IDOR و tenant isolation را برای تمام routeهای جدید/تغییریافته تست کن.
- سازمان A نباید با ID متعلق به سازمان B بتواند Payment، Charge، Deposit، Allocation، Expense یا Reversal را بخواند/تغییر دهد.
- ترکیب Resident متفاوت در یک Organization نیز باید رد شود.
- تلاش جعل actor، organizationId، role، postedBy یا فیلدهای سیستمی باید رد شود.

---

## ۶. موارد P2 و سخت‌سازی تکمیلی

این موارد را بررسی و تا جایی که با تصمیم‌های قطعی سازگارند اصلاح کن. اگر اصلاح در M3c به تغییر تصمیم محصول نیاز دارد، آن را با دلیل در گزارش ثبت کن و بی‌اجازه scope را گسترش نده.

1. **روش پرداخت Expense:** D-14 می‌گوید Expense هزینهٔ واقعاً پرداخت‌شده است و D-16 روش‌های پرداخت دستی را تعریف می‌کند. بررسی کن آیا `paymentMethod` در DTO، OpenAPI و مدل اختیاری باقی مانده است. اگر سند قطعی، روش پرداخت را برای Expense الزامی می‌کند، validation و constraint مناسب را اضافه کن.
2. **روش/تاریخ Refund:** بررسی کن PaymentRefund و Deposit refund برای روش برگشت وجه و businessDate چه اطلاعات ساختاری دارند. برای گزارش Cash/Bank/Mobile Money نباید تنها به JSON در Audit وابسته باشیم. هر فیلد جدید فقط با تطبیق دستور فاز ۹ و ADR اضافه شود.
3. **CHECK مثبت بودن مبلغ:** migrationهای قبلی را بخوان و بررسی کن DepositTransaction و Expense در DB نیز `amount > 0` دارند. اگر فقط DTO کنترل می‌کند، قید دیتابیس لازم را اضافه کن. از افزودن قید تکراری یا ناسازگار پرهیز کن.
4. **Append-only بودن:** migration M3c قبلاً DELETE blocker اضافه کرده، اما UPDATE immutability همهٔ eventهای مالی باید بررسی شود. برای رویدادهای append-only UPDATE/DELETE خاموش را ببند. اگر lifecycle مشخصی به UPDATE نیاز دارد، فقط همان transition محدود و مجاز را نگه دار و آن را مستند کن؛ trigger عمومی نباید reversal قانونی را خراب کند.
5. **LedgerReversal.sourceId:** چون FK چندریختی ساده در PostgreSQL ممکن نیست، بررسی کن source وجود دارد و با organization/resident درست مرتبط است. راهکار می‌تواند relation table، trigger یا validation تراکنشی دقیق باشد. ادعای FK وجود نداشته را نکن.
6. **Audit:** هیچ token، password، secret یا PII غیرضروری وارد Audit نشود. Audit مالی در همان transaction ثبت شود و mutation معمولی نتواند آن را Update/Delete کند.
7. **Constraintهای چندسازمانی:** FK ساده به‌تنهایی تعلق والد و فرزند به یک Organization را ثابت نمی‌کند. برای روابط تازه/تغییریافته composite FK یا کنترل DB متناسب اضافه و تست کن.
8. **خطاهای مالی:** خطای over-balance، source reversed، role forbidden، tenant mismatch و idempotency conflict باید code/status پایدار و مطابق Error Model/OpenAPI داشته باشند.

---

## ۷. اصلاح CI و گزارش‌پذیری خطا

در بازبینی قبلی، `.github/workflows/ci.yml` فقط روی push به `main` و `pull_request` اجرا می‌شد؛ چون PR واقعی M3c موجود نبود، برای commit شاخهٔ feature نیز workflow اجرا نشده بود. همچنین workflow گزارش‌شده `lint` و `format:check` را اجرا نمی‌کرد، در حالی که کیفیت‌گیت فاز ۹ آن‌ها را لازم می‌داند.

**الزام‌ها:**

1. workflow را با ترتیب و نام روشن گام‌ها تنظیم کن؛ حداقل:
   - `npm ci`
   - Prisma validate/generate در ترتیب درست پروژه
   - TypeScript build
   - ESLint lint
   - Prettier format check
   - OpenAPI lint
   - Unit tests
   - Integration tests روی PostgreSQL واقعی/سرویس CI
   - تست migration روی DB خالی
   - تست migration از baseline پشتیبانی‌شده
   - `scripts/test-m3c-migration.cjs`
2. از `npm run lint` و `npm run format:check` فقط وقتی استفاده کن که script معتبر وجود دارد؛ اگر وجود ندارد script و config درست ایجاد کن و نسخه‌ها را با lockfile pin کن.
3. فرمان شکست‌خورده را با `|| true`، `continue-on-error` یا shell behavior پنهان نکن.
4. برای هر مرحله نام دقیق و قابل‌تشخیص بگذار. خروجی Jest و Redocly و Prisma باید در log باقی بماند.
5. یک summary قابل خواندن در GitHub Actions ایجاد کن که مرحلهٔ شکست‌خورده، فرمان، exit code و لینک artifact/log را مشخص کند.
6. در صورت شکست، artifactهای مفید مانند JUnit XML، گزارش coverage در صورت موجود بودن، و migration diagnostics را با رعایت نبود secret ذخیره کن.
7. هیچ secret، `.env`، connection string حاوی password، token یا دادهٔ واقعی را در artifact چاپ نکن.
8. CI باید failure واقعی را با exit code غیرصفر نشان دهد؛ سبز کردن مصنوعی یا حذف تست ممنوع است.
9. اگر تست‌ها به متغیرهای محیطی نیاز دارند، از secretهای GitHub و سرویس DB موقت استفاده کن؛ secret را در log چاپ نکن.
10. بررسی کن branch protection یا triggerها مانع اجرای workflow روی PR نمی‌شوند.

### تناقض تعداد تست‌ها

گزارش M3c عدد 20/20 را اعلام کرده بود، اما بررسی فایل‌های source تعداد زیر را نشان می‌داد:

- `m3c-deposits-refund-reversal.integration-spec.ts`: بیست test declaration
- `m3c-concurrency.integration-spec.ts`: چهار test declaration
- `m3c-reconciliation.integration-spec.ts`: یک test declaration
- جمع source-level مشاهده‌شده: **25**

این شمارش جای خروجی Jest را نمی‌گیرد. تست واقعی را اجرا کن و با reporter خروجی، تعداد passed/failed/skipped و suiteها را دقیق اعلام کن. علت تفاوت 20 و 25 را پیدا کن؛ اگر 25 اجرا می‌شود، گزارش قبلی را اصلاح کن. اگر بخشی اجرا نمی‌شود، دلیلش را پیدا و suite را اصلاح کن. تستی را برای تطبیق ظاهری عدد حذف یا skip نکن.

---

## ۸. ماتریس آزمون پذیرش M3c

برای هر مورد تست قابل اجرا اضافه یا تست موجود را به‌صورت روشن اصلاح کن. تست‌های service-level را حفظ کن، اما برای مسیرهای امنیتی و contract تست HTTP نیز لازم است.

### ۸.۱ Payment و Allocation

- Payment بدون Allocation، تخصیص جزئی و کامل.
- Allocation به Chargeهای متعدد طبق قرارداد.
- over-allocation در Payment و Charge رد شود.
- refund از وجه تخصیص‌نیافته و سقف آن.
- refund سپس allocation؛ allocation سپس release؛ release سپس refund.
- refund و allocation هم‌زمان روی یک Payment.
- Payment reversed؛ تلاش refund یا allocation بعدی باید مطابق state machine رد شود.
- DAPP از مسیر عمومی قابل ساخت نباشد.
- DAPP رسید و Receipt Counter مصرف نکند.
- Idempotency با همان key و body؛ همان key با body متفاوت؛ duplicate هم‌زمان.

### ۸.۲ Deposit

- RECEIVED؛ refund کامل/جزئی؛ forfeit کامل/جزئی؛ apply به Charge انتخاب‌شده.
- refund + forfeit + apply در مجموع از Received معتبر بیشتر نشوند.
- source reversed یا status غیر POSTED استفاده نشود.
- چند DepositTransaction برای یک Resident و چند Contract تاریخی.
- apply/refund/forfeit روی source درست محاسبه شوند.
- دو عملیات هم‌زمان نتوانند سقف یک ودیعه را رد کنند.
- DepositApplication به Payment و Allocation دقیق خود متصل باشد.
- برگشت DAPP ودیعه را دقیقاً یک بار بازگرداند.
- refund نقدی DAPP رد شود.
- پاسخ remaining balance با SQL مستقل برابر باشد.

### ۸.۳ Expense

- Expense فقط مبلغ مثبت و پرداخت‌شده.
- payment method و businessDate مطابق قرارداد.
- OPERATOR برای ثبت عادی مجاز و VIEWER غیرمجاز.
- reversal فقط OWNER/ADMIN و با دلیل.
- reversal مبلغ اصلی را حذف یا منفی نکند؛ اثر اقتصادی دقیق و direction مخالف داشته باشد.
- reconciliation جمع Expense معتبر و برگشت‌ها را تأیید کند.

### ۸.۴ Reversal و عدم دو بار خنثی‌شدن

- Charge بدون Allocation و با Allocation؛ در حالت دارای Allocation مطابق D-02 ابتدا releaseهای لازم انجام شوند.
- Payment با Allocation و بدون Allocation.
- PaymentRefund واقعی از PaymentReverse جدا باشد.
- Deposit RECEIVED و رویدادهای بعدی؛ DAPP.
- Expense.
- هر reversal به همان source درست وصل باشد، amount مثبت داشته باشد و side آن مخالف posting اصلی باشد.
- درخواست تکراری یا رقابت دو reversal فقط یک اثر مالی ایجاد کند.
- source اصلی و reversal در گزارش هر دو باقی بمانند.

### ۸.۵ Audit، Sync و Tenant

- Audit و SyncChange در همان transaction سند ثبت شوند.
- شکست Audit یا Sync باعث rollback کامل شود.
- هر entity تغییرکرده SyncChange متناسب داشته باشد.
- tenant A نتواند entityهای tenant B را مشاهده یا mutate کند.
- cross-resident و cross-contract links نامعتبر رد شوند.
- نقش‌ها در HTTP و service هر دو آزمون شوند.
- PII و secret در response، Audit و logs افشا نشود.

### ۸.۶ Reconciliation مستقل

Oracle تست نباید همان تابع محاسباتی سرویس باشد. داده‌های خام را جداگانه با SQL یا محاسبهٔ مستقل تست بخوان و این invariantها را کنترل کن:

- Payment معتبر منهای refund معتبر، با Allocation خالص و unapplied balance تطبیق کند.
- Allocation معتبر هر Charge از Charge Outstanding بیشتر نشود.
- Charge Outstanding = بدهی معتبر − Allocation معتبر − Credit اعمال‌شده.
- Deposit Held = RECEIVED معتبر − REFUNDED معتبر − FORFEITED معتبر − APPLIED معتبر، با لحاظ reversalها.
- هر DAPP دقیقاً با Payment و Allocation خودش تطبیق داشته باشد.
- Expense net total با posting و reversal درست تطبیق کند.
- LedgerReversal direction و اثر نهایی هر source با سند اصلی سازگار باشد.
- جمع statement line items با summary برابر باشد.
- برگشت Payment، releaseهای Allocation و برگشت DepositApplication دوبار یک اثر را خنثی نکنند.

---

## ۹. Migration و محیط آزمون

1. migration موجود M3c را دقیق بخوان؛ فقط به اسکریپت 29-check اعتماد نکن.
2. `scripts/test-m3c-migration.cjs` را اجرا کن و خروجی تمام checkها را ثبت کن.
3. migration را روی PostgreSQL موقت خالی از ابتدا تا آخرین migration اجرا کن.
4. یک clone دورریختنی از baseline پشتیبانی‌شده بساز و upgrade تا head را اجرا کن؛ هدف آزمایش است، نه دست‌کاری `eskan_dev`.
5. اگر schema تغییر کرد، migration جدید بساز؛ migration اعمال‌شدهٔ قبلی را ویرایش نکن.
6. migration باید داده‌های موجود را حفظ کند؛ برای constraint جدید، ابتدا دادهٔ ناسازگار را شناسایی و در صورت وجود مسیر backfill امن و مستند تعریف کن.
7. migration را روی DB خالی و baseline با `prisma migrate deploy` و ابزارهای تست موجود اجرا کن؛ در محیط production از `db push` استفاده نکن.
8. بعد از migration، Prisma schema و DB drift را بررسی کن و صفر بودن diff مورد انتظار را ثبت کن.
9. migration test باید قیدهای جدید DAPP receipt، amount > 0، source references و append-only behavior را آزمایش کند.
10. هیچ migration روی `eskan_dev`، Staging یا Production اجرا نکن؛ حتی اگر دسترسی یا connection string در محیط موجود باشد.

---

## ۱۰. مستندسازی و همگام‌سازی تصمیم‌ها

پس از تغییر کد:

1. `docs/architecture/decisions/ADR-0011-m3c-deposit-refund-expense-reversal.md` را اصلاح کن:
   - semantics دقیق Deposit source و balance؛
   - رابطهٔ DepositApplication/Payment/Allocation؛
   - برگشت DAPP و رویدادهای جبرانی؛
   - mapping صریح posting/reversal side؛
   - Checkout نهایی و شواهد آن؛
   - Idempotency response snapshot؛
   - اثرهای Sync/Audit.
2. `contracts/openapi.yaml` را با DTO و runtime هماهنگ کن؛ enum عمومی Payment نباید DAPP را بپذیرد.
3. در صورت تغییر response، schemaهای request/response و مثال‌ها را اصلاح کن.
4. `docs/project/progress.md` را با وضعیت واقعی و commit فعلی به‌روز کن.
5. یک گزارش مستقل ایجاد کن، برای نمونه:
   `docs/reports/m3c-remediation-and-acceptance-v1.md`
6. گزارش باید این جدول را داشته باشد:

| شناسه | مورد | شدت | تغییر انجام‌شده | تست/فرمان شاهد | نتیجه |
|---|---|---|---|---|---|

7. موارد حل‌نشده را با شدت، ریسک، علت، اثر مالی/امنیتی و تصمیم موردنیاز ثبت کن.
8. اگر موردی صرفاً با تغییر تصمیم محصول حل می‌شود، آن را به‌عنوان «نیازمند تصمیم مالک» بنویس، نه «رفع‌شده».

---

## ۱۱. ترتیب اجرایی الزامی

به این ترتیب پیش برو تا وابستگی‌ها رعایت شود:

1. خط پایهٔ Git و اجرای تست‌ها؛ تأیید وجود directive و ADR.
2. استخراج state machine و invariantهای Payment، Allocation، Refund، Deposit، DAPP، Expense و Reversal از دستور فاز ۹.
3. طراحی/اصلاح رابطه‌های schema لازم برای Deposit source و DepositApplication ↔ Payment ↔ Allocation.
4. اصلاح P0-1 مانده Payment و Refund.
5. اصلاح P0-2 ممنوعیت DAPP در مسیر عمومی و receipt.
6. اصلاح P0-3 برگشت اتمیک DAPP و محافظت مسیر refund/reverse.
7. اصلاح P1 ماندهٔ source-specific ودیعه و Checkout نهایی.
8. اصلاح جهت LedgerReversal و Idempotency replay.
9. اصلاح Sync/Audit تمام entityهای وابسته.
10. تکمیل HTTP authorization، tenant isolation و race tests.
11. بررسی P2، constraints و append-only.
12. اصلاح OpenAPI، CI و گزارش‌پذیری failure.
13. اجرای migration rehearsal روی DB خالی و baseline clone.
14. اجرای کامل build/lint/format/OpenAPI/unit/integration/migration/reconciliation.
15. بازبینی نهایی diff، ADR، progress و گزارش.

در هر مرحله ابتدا تست بازتولیدکنندهٔ مشکل را اضافه کن، بعد اصلاح را انجام بده، سپس تست را اجرا کن. از نوشتن یک اصلاح بزرگ بدون تست‌های مستقل اجتناب کن.

---

## ۱۲. فرمان‌ها و شواهدی که باید در گزارش نهایی بیاید

فرمان‌ها را با scriptهای واقعی `package.json` تطبیق بده؛ نامی را که در پروژه وجود ندارد وانمود نکن. حداقل این حوزه‌ها باید اجرا و نتیجهٔ واقعی‌شان گزارش شود:

- `npm ci` در محیط CI یا نصب قابل‌بازتولید.
- Prisma validate و generate.
- NestJS/TypeScript build.
- ESLint.
- Prettier format check.
- OpenAPI lint (`npx @redocly/cli@1.25.15 lint contracts/openapi.yaml` یا نسخهٔ pin شدهٔ repo).
- Unit tests.
- Integration tests با PostgreSQL واقعی.
- Migration test script.
- Empty database migration.
- Baseline clone upgrade.
- Reconciliation suite.
- `git diff --check` و بازبینی `git diff --stat` و `git status`.

برای هر فرمان ثبت کن:

- فرمان کامل؛
- exit code؛
- تعداد تست‌های passed/failed/skipped؛
- نسخهٔ Node/npm/PostgreSQL/Prisma مرتبط؛
- نام DB آزمایشی (بدون credential)؛
- SHA دقیق کدی که تست شده است.

اگر یک فرمان به‌دلیل نبود ابزار، دسترسی یا محیط اجرا نشد، صریح بنویس **NOT RUN** و دلیلش را بیاور. آن را PASS حساب نکن.

---

## ۱۳. محدودیت‌های غیرقابل‌مذاکره

- فرانت‌اند Flutter، Android، Windows، SQLite یا Drift را در این مأموریت نساز.
- M3d یا Statement API را زودتر از موعد پیاده‌سازی نکن؛ فقط داده‌ها و semantics لازم برای مصرف درست در M3d را شفاف کن.
- حسابداری دوطرفهٔ عمومی، AP، درگاه پرداخت، پرداخت خودکار یا ارز چندگانه اضافه نکن.
- `DEPOSIT_APPLICATION` را با دریافت پول نقد یکی نکن.
- مبلغ منفی را برای اصلاح سند به کار نبر؛ amount رویداد مثبت و direction/status مطابق قرارداد باشد.
- اسناد مالی و Audit را حذف یا بازنویسی خاموش نکن.
- Idempotency یا tenant isolation را برای آسان‌تر شدن تست دور نزن.
- تست را skip/disable نکن تا pipeline سبز شود.
- خطاها را با catch خالی، `|| true` یا `continue-on-error` پنهان نکن.
- کد غیرمرتبط را refactor گسترده نکن.
- هیچ داده یا migration واقعی را بدون اجازه تغییر نده.
- هیچ commit را merge نکن و به `main` push نکن.
- پس از تکمیل اصلاحات، در صورت دسترسی مجاز می‌توانی branch را push و PR به `main` باز کنی تا CI واقعی اجرا شود؛ اما PR را **هرگز merge نکن**. اگر مجوز push/PR نداری، تغییرات محلی و دستور دقیق ادامه را گزارش کن.
- وضعیت «آمادهٔ merge» را فقط وقتی اعلام کن که CI واقعی روی SHA نهایی اجرا شده و همهٔ acceptance gateها PASS باشند. در غیر این صورت وضعیت را «آمادهٔ بررسی»، «Blocked» یا «NOT VERIFIED» اعلام کن.

---

## ۱۴. قالب گزارش نهایی عامل

گزارش نهایی باید دقیقاً این بخش‌ها را داشته باشد:

### A. حکم اجرایی
یکی از این وضعیت‌ها را انتخاب کن:
- `READY FOR REVIEW` — اصلاحات انجام شده، اما هنوز تأیید مستقل/CI نهایی لازم است.
- `READY FOR MERGE` — تمام gateها روی SHA نهایی PASS و شواهد CI واقعی موجود است؛ با این وجود merge نکن.
- `BLOCKED` — یک مانع محصولی/فنی حل‌نشده وجود دارد.
- `PARTIALLY COMPLETED` — بخشی انجام شده و بخشی باقی مانده.

### B. خط پایه
branch، base SHA، head SHA، PR number (اگر واقعاً وجود دارد)، working tree status.

### C. جدول اصلاحات
تمام P0/P1/P2 با وضعیت PASS/FAIL/NOT RUN و لینک فایل/تست.

### D. شواهد تست
فرمان‌ها، exit code، تعداد دقیق تست‌ها، تست‌های skip شده و علت آن‌ها.

### E. Migration
نتیجهٔ empty DB، baseline clone، migration checks، drift و تأیید صریح اینکه محیط‌های واقعی دست‌نخورده مانده‌اند.

### F. CI/GitHub
آیا workflow روی SHA نهایی اجرا شد؟ نتیجهٔ هر job چیست؟ لینک run/PR را فقط اگر واقعی است بده. اگر workflow اجرا نشده، دلیل trigger یا مجوز را روشن کن.

### G. تصمیم‌های باز و ریسک‌ها
هر مانع حل‌نشده با پیامد مالی/امنیتی و تصمیم دقیق موردنیاز مالک.

### H. گام بعدی
فقط یک گام بعدی مشخص و قابل‌اجرا؛ نه فهرست بلند کارهای احتمالی.

**اصل نهایی صداقت:** وجود تست در فایل به معنی اجرای آن نیست؛ build موفق به معنی correctness مالی نیست؛ CI triggerنشده به معنی CI سبز نیست؛ migration آزمایشی به معنی migration روی production نیست؛ و بازشدن PR به معنی پذیرش یا merge نیست.

اکنون از بخش ۳ شروع کن و کار را مرحله‌به‌مرحله انجام بده.
