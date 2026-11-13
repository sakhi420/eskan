# دستور عامل اصلی — اجرای Migration مالی M3c روی دیتابیس توسعه ESKAN

**شناسه:** ESKAN-M3C-DEV-MIGRATION-EXECUTION-v1.0  
**تاریخ صدور:** 2026-11-13  
**مخزن:** `sakhi420/eskan`  
**شاخهٔ کد پس از ادغام:** `main`  
**دامنهٔ این مأموریت:** اجرای دو Migration مربوط به M3c روی دیتابیس توسعهٔ محلی `eskan_dev`، با Backup و Restore rehearsal واقعی؛ سپس ثبت شواهد و تحویل به M3d.  
**مالک محصول:** مالک ESKAN  
**وضعیت کد:** PR #5 برای ادغام توسط مالک مجاز شده است؛ این دستور فقط برای اجرای دیتابیس پس از ادغام و Pull آخرین `main` است.

---

## 1. مأموریت و نتیجهٔ مورد انتظار

تو عامل اصلی مهندسی بک‌اند ESKAN هستی. مأموریت تو این است که Migrationهای مالی M3c را **فقط روی دیتابیس توسعهٔ محلی `eskan_dev`** به شکل کنترل‌شده، قابل‌تکرار و قابل‌بازیابی اجرا کنی.

دو Migration هدف:

1. `20261112000000_m3c_deposit_refund_expense_reversal`
2. `20261112120000_m3c_dapp_reversal_and_deposit_source`

این مأموریت صرفاً اجرای `prisma migrate deploy` نیست. ابتدا باید هویت دیتابیس را ثابت کنی، baseline را بررسی کنی، Backup معتبر تهیه کنی، همان Backup را در یک دیتابیس جداگانه Restore کنی، Migrationها را روی Clone اجرا کنی و آزمون‌های لازم را بگذرانی. تنها پس از موفقیت این مراحل، Migrationها را روی `eskan_dev` اجرا کن.

### نتیجهٔ قابل قبول

- `eskan_dev` پیش از تغییر، Backup معتبر و قابل Restore داشته باشد.
- Backup در دیتابیس جداگانهٔ محلی Restore شده و صحت Restore ثبت شده باشد.
- هر دو Migration M3c ابتدا روی Clone اجرا و اعتبارسنجی شده باشند.
- preflight دادهٔ قدیمی، migration status، Prisma parity، آزمون‌های Migration و بررسی‌های مالی لازم موفق باشند.
- سپس هر دو Migration روی `eskan_dev` اعمال شوند.
- `npx prisma migrate status` روی `eskan_dev` نتیجهٔ Up to date بدهد.
- شواهد کامل اجرا در گزارش عملیاتی ثبت و `docs/project/progress.md` به‌روز شود.
- هیچ Backup، فایل محیطی یا Secret وارد Git نشود.
- پس از موفقیت، پروژه آمادهٔ آغاز M3d باشد؛ **این مأموریت خودِ M3d را پیاده‌سازی نمی‌کند.**

---

## 2. مرجع حقیقت و تقدم اسناد

قبل از هر فرمان، این اسناد را از آخرین `origin/main` بخوان:

1. `ESKAN_PHASE9_EXECUTION_DIRECTIVE_v1_FA.md` — مرجع اجرایی قطعی فاز ۹ و تصمیم‌های قفل‌شدهٔ D-01 تا D-18.
2. `docs/operations/m3c-implementation-report.md`.
3. `docs/reports/m3c-remediation-and-acceptance-v1.md`.
4. `docs/reports/m3c-independent-review-handoff-v1.md`.
5. `prisma/schema.prisma` و هر دو Migration هدف.
6. `scripts/test-m3c-migration.cjs`، `scripts/test-m2-prisma-parity.cjs` و تست‌های integration مالی.
7. `docs/project/progress.md`.

در صورت تعارض:
- دستور اجرایی قطعی فاز ۹ و تصمیم‌های D-01 تا D-18 مقدم‌اند.
- `progress.md` و گزارش‌های M3c وضعیت ثبت‌شده‌اند؛ آن‌ها مجوز تغییر تصمیم‌های قفل‌شده نیستند.
- مسترپرامپت Backend v3 و گزارش ممیزی Engineering Readiness مورخ ۵ نوامبر، منابع تاریخی/زمینه‌ای‌اند و نباید تصمیم‌های جدیدتر را بازنویسی کنند.

اگر دستور اجرایی قطعی فاز ۹ در شاخهٔ `main` پیدا نشد، یا نسخهٔ محلی با نسخهٔ منبع تناقض داشت، Migration را اجرا نکن؛ مسیر و علت را گزارش بده.

---

## 3. مرز محیطی — بسیار مهم

### تنها مقصد مجاز

`eskan_dev` روی PostgreSQL محلی توسعه‌دهنده.

پیش از هر Migration، با Query واقعی ثابت کن:

- `current_database() = 'eskan_dev'`
- سرور محلی است و مقصد، PostgreSQL محلی توسعه است؛ برای این مأموریت Host باید `localhost` یا `127.0.0.1` یا `::1` باشد.
- نقش دیتابیس و نسخهٔ PostgreSQL ثبت شود.
- اتصال از config فعال برنامه به همین دیتابیس اشاره می‌کند.

### مقصدهای ممنوع

- Staging
- Production
- هر دیتابیس ابری/راه‌دور
- هر دیتابیس پروژهٔ دیگر، از جمله `weshbazar*`
- هر دیتابیسی غیر از `eskan_dev` برای اجرای Migration نهایی

**هیچ‌گاه** فقط از روی نام متغیر `DATABASE_URL` اعتماد نکن. URI را parse کن و host، port و database name را بدون چاپ username/password ثبت کن. Secretها را در خروجی ترمینال، گزارش، Screenshot، Git یا پاسخ نهایی آشکار نکن.

اگر دیتابیس هدف محلی و `eskan_dev` نبود، کار را متوقف کن. مقصد دیگری را خودسرانه انتخاب نکن.

---

## 4. قواعد غیرقابل مذاکرهٔ ایمنی

1. از `prisma migrate deploy` استفاده کن؛ `prisma migrate dev`، `prisma db push` و تغییر دستی Schema ممنوع‌اند.
2. Migrationهای قبلی را ویرایش یا حذف نکن.
3. `_prisma_migrations` را دستی INSERT/UPDATE/DELETE نکن.
4. روی دیتابیس اصلی از `pg_restore --clean`، `DROP DATABASE`، `TRUNCATE` یا reset استفاده نکن.
5. Restore همیشه در یک دیتابیس Clone تازه و جدا انجام شود؛ دیتابیس منبع را جایگزین نکن.
6. Backup را در پوشهٔ خارج از مخزن یا مسیر صریحاً نادیده‌گرفته‌شده توسط Git ذخیره کن. فایل Backup، کلید رمزگذاری، `.env` و dump هرگز commit/push نشوند.
7. از روش امن موجود برای حفاظت/رمزگذاری Backup در حالت سکون استفاده کن. دسترسی فایل را محدود کن. اگر Backup حاوی دادهٔ حساس است و حفاظت امن آن فراهم نیست، پیش از ادامه متوقف شو.
8. قبل از Migration، دستور و مقصد را دوباره بررسی کن؛ Query هویت DB را در همان نشست/Processی اجرا کن که Migration را اجرا می‌کند.
9. هیچ دادهٔ Legacy را حدس نزن، بازنویسی نکن یا از Audit JSON برای ساخت Source Link استفاده نکن.
10. در صورت شکست، هیچ rollback دستی/حدسی روی دیتابیس اصلی انجام نده. وضعیت را حفظ، گزارش و برای تصمیم Recovery ارائه کن.
11. وجود فایل Backup به‌تنهایی موفقیت Backup محسوب نمی‌شود؛ Restore rehearsal واقعی اجباری است.
12. Migration را فقط یک بار در هر محیط اجرا کن؛ اگر وضعیت Migration نامشخص یا نیمه‌کاره است، ابتدا بررسی کن و Migration را کورکورانه دوباره اجرا نکن.

---

## 5. Gate A — دریافت نسخهٔ نهایی و خط مبنا

1. با `git status --short --branch` وضعیت Working Tree را ثبت کن.
2. اگر تغییر محلی کاربر وجود دارد، آن را پاک، reset یا overwrite نکن. قبل از ادامه وضعیت را حفظ و گزارش کن.
3. `git fetch origin` را اجرا کن.
4. پس از تأیید ادغام PR #5، روی `main` برو و فقط با `git pull --ff-only origin main` به آخرین نسخه برس.
5. SHA فعلی `main` و وضعیت Working Tree را ثبت کن.
6. فایل‌های دو Migration هدف باید دقیقاً در مسیرهای اعلام‌شده موجود باشند.
7. `package-lock.json` را حفظ کن؛ `npm ci` را برای نصب بازتولیدپذیر اجرا کن.
8. فرمان‌های زیر را اجرا و خروجی واقعی را ثبت کن:

~~~powershell
git status --short --branch
git rev-parse HEAD
npm ci
npx prisma validate
npx prisma generate
npm run build
npm run openapi:validate
~~~

اگر نسخهٔ Node با `engines` پروژه سازگار نیست یا Build/Prisma/OpenAPI شکست خورد، Migration دیتابیس را شروع نکن. ابتدا علت را مشخص کن؛ در محدودهٔ این مأموریت کد مالی یا Migration را برای سبزکردن ظاهری تغییر نده.

---

## 6. Gate B — تشخیص هویت و وضعیت دیتابیس

1. config فعال Prisma/Nest و فایل‌های محیطی را بررسی کن؛ هیچ Secret را چاپ نکن.
2. با اتصال واقعی، Query زیر را اجرا کن و فقط فیلدهای غیرمحرمانه را ثبت کن:

~~~sql
SELECT
  current_database() AS database_name,
  current_user AS database_role,
  inet_server_addr() AS server_address,
  inet_server_port() AS server_port,
  version() AS postgres_version;
~~~

3. نتیجه باید دقیقاً دیتابیس `eskan_dev` و سرور محلی باشد. در غیر این صورت Stop.
4. وضعیت Migrationها را ثبت کن:

~~~powershell
npx prisma migrate status
~~~

5. سوابق Migration مربوط را بخوان:

~~~sql
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20261112000000_m3c_deposit_refund_expense_reversal',
  '20261112120000_m3c_dapp_reversal_and_deposit_source'
)
ORDER BY migration_name;
~~~

6. وضعیت مورد انتظار: Migrationهای قبلی M-1/M-2/4c/M3a/M3b اعمال شده باشند و دو Migration M3c هنوز در وضعیت موفق ثبت نشده باشند.

**شرایط توقف:**
- فقط یکی از دو Migration هدف اعمال شده باشد.
- ردیف failed یا نیمه‌کاره برای Migrationهای هدف وجود داشته باشد.
- Migration قبلی مورد انتظار جا افتاده باشد.
- schema drift یا وضعیت نامشخص وجود داشته باشد.
- دیتابیس با baseline مخزن تطابق نداشته باشد.

در این وضعیت، Migration را دوباره اجرا نکن. شواهد را ثبت و یک مسیر Recovery مستقل پیشنهاد کن.

---

## 7. Gate C — Preflight دادهٔ Legacy

Migration اول M3c عمداً پیش از هر DDL بررسی می‌کند که رویدادهای قدیمی `REFUNDED` یا `FORFEITED` بدون Source Link وجود نداشته باشند.

پیش از Backup و Clone، شمارش داده را ثبت کن:

~~~sql
SELECT type, status, COUNT(*) AS row_count
FROM deposit_transactions
WHERE type IN ('REFUNDED', 'FORFEITED')
GROUP BY type, status
ORDER BY type, status;
~~~

همچنین کل تعداد رکوردهای `deposit_transactions`، `expenses`، `payments` و `charges` را برای reconciliation قبل/بعد ثبت کن.

- اگر هیچ Legacy REFUNDED/FORFEITED وجود نداشته باشد، طبق مسیر عادی ادامه بده.
- اگر هرکدام وجود داشتند، اجرای Migration اول باید طبق طراحی fail-fast شود؛ **اجازه نداری** Source Link را از Audit JSON حدس بزنی یا داده را بی‌اجازه اصلاح کنی.
- در صورت وجود این داده‌ها، تعداد و شناسه‌های داخلی لازم را به‌صورت امن گزارش کن؛ PII، توضیحات و اطلاعات مالی اشخاص را در گزارش عمومی چاپ نکن. عملیات متوقف می‌شود تا برنامهٔ mapping/reconciliation صریح و تأییدشده تعریف شود.

---

## 8. Gate D — Backup واقعی و قابل اعتبارسنجی

1. مسیر Backup خارج از مخزن و خارج از هر پوشهٔ Sync عمومی انتخاب کن؛ برای مثال یک مسیر اختصاصی محلی با دسترسی محدود.
2. نام فایل شامل نام DB و timestamp باشد؛ از overwrite فایل قبلی جلوگیری کن.
3. با ابزار رسمی PostgreSQL، Backup کامل در قالب custom بگیر. از `pg_dump` و تنظیمات سازگار با نسخهٔ PostgreSQL استفاده کن.
4. Backup باید شامل Schema، data، constraints، indexes، functions، triggers و migration history باشد؛ owner/ACL را مطابق روش Restore محیط محلی مدیریت کن.
5. نتیجهٔ فرمان را بررسی کن؛ Exit code صفر، فایل غیرخالی و archive list قابل خواندن الزامی است.
6. SHA-256 فایل را ثبت کن.
7. مجوز فایل و حفاظت at-rest را بررسی کن.
8. Backup را به Git اضافه نکن و هرگز آن را به GitHub نفرست.

نمونهٔ منطقی فرمان برای ابزار نصب‌شدهٔ PostgreSQL (مسیر و متغیرها را با محیط واقعی تطبیق بده؛ Secret را چاپ نکن):

~~~powershell
pg_dump --format=custom --no-owner --no-acl --file="$BackupFile" "$env:DATABASE_URL"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
if (!(Test-Path $BackupFile) -or (Get-Item $BackupFile).Length -le 0) {
  throw "Backup file is missing or empty"
}
pg_restore --list "$BackupFile" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Backup archive validation failed" }
Get-FileHash -Algorithm SHA256 $BackupFile
~~~

اگر روش Backup امن و قابل Restore در محیط موجود نیست یا ابزار لازم نصب نیست، Migration اصلی را اجرا نکن. صرفاً به export دستی چند جدول اکتفا نکن.

---

## 9. Gate E — Restore rehearsal روی Clone جداگانه

1. یک نام یکتا برای دیتابیس Clone بساز، مانند `eskan_m3c_rehearsal_YYYYMMDD_HHMMSS`.
2. مطمئن شو این نام از قبل وجود ندارد. هیچ دیتابیس دیگری را overwrite یا drop نکن.
3. دیتابیس Clone خالی را با encoding/locale مناسب PostgreSQL ایجاد کن.
4. Backup Gate D را با `pg_restore --exit-on-error` در Clone بازیابی کن.
5. Query هویت Clone باید نام Clone را نشان دهد؛ نه `eskan_dev`.
6. نسخهٔ Schema و `_prisma_migrations` و شمارش رکوردهای کلیدی را با baseline قبل از Backup مقایسه کن.
7. `npx prisma migrate status` را روی Clone اجرا کن؛ در این لحظه Clone هنوز باید baseline پیش از M3c را نشان دهد.
8. روی Clone فقط، دو Migration M3c را با `npx prisma migrate deploy` اعمال کن.
9. سپس `npx prisma migrate status`، queryهای constraint/index/trigger لازم و Prisma parity را اجرا کن.
10. Clone را برای گزارش حفظ کن؛ تا وقتی شواهد آن ثبت نشده، حذف نشود.

برای تغییر موقت مقصد Prisma در Clone، URL را با parser امن بساز؛ متن کامل URL را در ترمینال چاپ نکن. مقصد اصلی `eskan_dev` باید در متغیر/اتصال اصلی دست‌نخورده بماند. نام Clone باید در گزارش ثبت شود.

**قبولی Gate E:** Backup واقعی Restore شده باشد؛ Migrationها روی Clone موفق باشند؛ Prisma schema با دیتابیس پس از Migration سازگار باشد؛ شمارش داده‌های قبل/بعد و نمونه‌های مالی قابل reconciliation باشند.

---

## 10. Gate F — آزمون‌های پس از Migration روی Clone و تست‌های ایزوله

با `DATABASE_URL` مناسب و بدون تغییر دادن دیتابیس منبع:

1. `node scripts/test-m3c-migration.cjs` را اجرا کن و نتیجهٔ تمام checks را ثبت کن.
2. `node scripts/test-m2-prisma-parity.cjs` را اجرا کن و خالی بودن migration diff را تأیید کن.
3. تست‌های integration مالی و E2E مرتبط را مطابق اسکریپت‌های پروژه اجرا کن:

~~~powershell
npm run test:e2e
npm run test:integration
~~~

4. اگر تست‌ها از DB پایه برای ساخت دیتابیس‌های disposable استفاده می‌کنند، اول منطق همان اسکریپت را بخوان تا مطمئن شوی فقط دیتابیس‌های موقت ساخته/حذف می‌شوند. `ESKAN_TEST_DB_ALLOW=1` را کورکورانه فعال نکن و guard محیط را تضعیف نکن.
5. آزمون‌های M3c باید این موارد را پوشش دهند: legacy preflight، source-scoped balances، refund/forfeit/apply cap، DAPP links/receipt/one allocation، DAPP reversal ordering، Charge reversal guard، immutability، tenant composite FKs، concurrent source locks و rollback.
6. اگر هر تست مالی، Prisma parity یا reconciliation fail شد، به Gate G نرو. علت را با خروجی واقعی مشخص کن. Test، migration یا source code را فقط برای پنهان‌کردن شکست تغییر نده.

---

## 11. Gate G — اجرای کنترل‌شده روی eskan_dev

فقط پس از PASS شدن Gateهای A تا F:

1. اتصال هدف را دوباره در همان Process بررسی کن. باید دقیقاً `eskan_dev` و Host محلی باشد.
2. وجود Backup معتبر و Restore rehearsal موفق را به‌صورت ماشینی/مستند تأیید کن.
3. `npx prisma migrate status` را یک بار دیگر اجرا کن؛ فقط دو Migration M3c باید pending باشند.
4. Query تعداد Legacy REFUNDED/FORFEITED را دوباره اجرا کن؛ نتیجه باید با preflight موفق Clone سازگار باشد.
5. Migration deploy را روی مقصد تأییدشده اجرا کن:

~~~powershell
npx prisma migrate deploy
~~~

در اجرای این فرمان، `DATABASE_URL` باید در همان نشست به `eskan_dev` اشاره کند؛ هیچ URL یا Secret را چاپ نکن.

6. خروجی واقعی فرمان، زمان شروع/پایان و نسخهٔ CLI را ثبت کن.
7. هیچ فرمان دیگری برای حذف/بازنویسی داده اجرا نکن.

---

## 12. Gate H — Post-migration verification روی eskan_dev

1. وضعیت نهایی را بررسی کن:

~~~powershell
npx prisma migrate status
npx prisma validate
~~~

2. Query زیر باید دقیقاً دو Migration هدف را با `finished_at IS NOT NULL`، `rolled_back_at IS NULL` و بدون failure logs نشان دهد:

~~~sql
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20261112000000_m3c_deposit_refund_expense_reversal',
  '20261112120000_m3c_dapp_reversal_and_deposit_source'
)
ORDER BY migration_name;
~~~

3. وجود جدول‌ها، ستون‌ها، unique/composite foreign keys، indexes و triggers را از `pg_catalog` / `information_schema` بررسی کن؛ به پیام موفق Migration به‌تنهایی بسنده نکن.
4. شمارش رکوردهای کلیدی را با Gate B مقایسه کن. Migration M3c نباید رکوردهای قبلی Charge/Payment/Resident/Contract را حذف یا silent rewrite کند.
5. `node scripts/test-m3c-migration.cjs` و `node scripts/test-m2-prisma-parity.cjs` را مطابق قرارداد این اسکریپت‌ها اجرا کن؛ مطمئن شو هر دو فقط DBهای disposable را تغییر می‌دهند.
6. آزمون‌های مالی، Integration و HTTP smoke مرتبط را اجرا کن.
7. وضعیت `eskan_dev` را به‌عنوان M3c Applied ثبت کن؛ Staging و Production همچنان Not Applied هستند.

### اگر Migration یا آزمون پس از اجرا شکست خورد

- بلافاصله عملیات را متوقف کن.
- Migration را دوباره اجرا یا `_prisma_migrations` را دستی دست‌کاری نکن.
- روی دیتابیس اصلی `DROP`، `TRUNCATE`، `migrate reset` یا Restore مخرب انجام نده.
- Backup اصلی را حفظ کن و یک Recovery Clone جداگانه بساز.
- Log، migration rowها، schema state و آخرین checkpoint سالم را ثبت کن.
- گزارش کن آیا Migration اول اعمال شده و Migration دوم شکست خورده است یا نه.
- فقط مسیر Recovery با حفظ داده ارائه کن؛ Restore روی DB اصلی بدون تصمیم جداگانهٔ مالک ممنوع است.

---

## 13. Gate I — ثبت گزارش و بستن M3c migration gate

پس از PASS کامل:

1. گزارشی با مسیر `docs/operations/m3c-dev-migration-execution-report.md` بساز.
2. گزارش باید شامل این موارد باشد:
   - SHA شاخهٔ `main` و نسخهٔ Node/npm/Prisma/PostgreSQL؛
   - نام DB هدف و Host غیرمحرمانه؛
   - نام Clone و زمان Restore rehearsal؛
   - مسیر Backup (بدون Secret)، حجم فایل و SHA-256؛
   - نتیجهٔ archive validation و Restore؛
   - وضعیت Migration قبل/بعد؛
   - شمارش رکوردهای قبل/بعد؛
   - نتیجهٔ هر فرمان و Test با تعداد PASS/FAIL/SKIP؛
   - نام دو Migration و زمان اعمال آن‌ها؛
   - محدودیت‌ها، warningها و هر مانع؛
   - تصریح اینکه Staging/Production دست‌نخورده‌اند.
3. `docs/project/progress.md` را به‌روز کن: M3c migration روی `eskan_dev` تکمیل شده؛ M3d اکنون Gate بعدی است. وضعیت Backup و Staging/Production را دقیق جدا ثبت کن.
4. فقط گزارش/مستندات و تغییرات ضروری progress را commit کن. هیچ فایل Backup، dump، Secret یا env را commit نکن.
5. گزارش نهایی را با شواهد واقعی ارائه کن.

---

## 14. تحویل به فاز M3d — آغاز بعدی، نه توسعه در همین مأموریت

پس از تکمیل موفق Gate I، نقطهٔ بعدی طبق دستور اجرایی فاز ۹، **M3d — Account / Statement / Audit / Sync Pull** است.

محدودهٔ بعدی:
- یک canonical resident balance calculator؛
- سه bucket مستقل: Outstanding Receivable، Unapplied Payment/Credit، Deposit Held؛
- Statement با opening/closing balances و ترتیب deterministic؛
- SQL oracle reconciliation؛
- Audit read با tenant/role filtering؛
- Sync Pull با cursor، tombstone و resyncRequired؛
- cursor بدون skip در برابر commitهای هم‌زمان؛
- idempotency بلندمدت برای عملیات queueable؛
- سازگاری کامل با تصمیم‌های D-15، D-17 و D-18.

در این مأموریت هیچ‌کدام از این قابلیت‌ها را پیاده‌سازی نکن؛ فقط شواهد موفقیت M3c و نقطهٔ شروع M3d را تحویل بده.

---

## 15. قالب گزارش نهایی عامل

فقط واقعیت اجراشده را بنویس:

- **Status:** PASS / CONDITIONAL PASS / FAIL
- **Git:** branch، SHA و clean/dirty status
- **Target DB:** نام، Host، نسخهٔ PostgreSQL (بدون Secret)
- **Backup:** مسیر محافظت‌شده، حجم، SHA-256، archive validation
- **Restore rehearsal:** نام Clone و نتیجه
- **Migrations:** نام هر دو، وضعیت قبل/بعد، زمان اجرا
- **Tests:** نام فرمان و تعداد PASS/FAIL/SKIP
- **Reconciliation:** شمارش قبل/بعد و نتیجه
- **Environment boundary:** `eskan_dev=Applied`, `Staging=Not Applied`, `Production=Not Applied`
- **Open risks:** موارد باقی‌مانده و مانع واقعی
- **Next gate:** M3d

**قاعدهٔ نهایی:** هیچ موفقیتی را بدون خروجی واقعی گزارش نکن. اگر هر Gate ایمنی رد شد، Migration اصلی را اجرا نکن؛ داده را حفظ کن و شواهد و راه‌حل را تحویل بده.