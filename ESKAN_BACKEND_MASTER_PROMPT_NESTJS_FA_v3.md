# مستر پرامپت مهندسی بک‌اند و قراردادهای API سامانهٔ «اسکان — ESKAN»

**نسخهٔ سند:** 3.0  
**محصول:** اسکان (ESKAN)  
**زبان مستندات و رابط مورد انتظار:** دری افغانستان  
**دامنه:** بک‌اند و قراردادهای API برای اپلیکیشن اندرویدی مدیریت لیلیه‌های خصوصی  
**خارج از دامنهٔ این سند:** ساخت فرانت‌اند Flutter/Dart، صفحات و ویجت‌های موبایل، دیتابیس محلی SQLite/Drift، طراحی گرافیکی و UI پنل وب، درگاه پرداخت خودکار/درون‌برنامه‌ای و اتصال بانکی. **داخل دامنه:** مدل طرح‌ها و محدودیت‌ها، دورهٔ آزمایشی، اشتراک سازمان، دسترسی‌های طرح، ثبت پرداخت دستی تأییدشده و APIهای امن Platform Admin برای فعال/تمدید/تعلیق اشتراک؛ این APIها بعداً توسط پنل ادمین جداگانه مصرف می‌شوند.  
**اصل حاکم:** هیچ قابلیت، تست، امنیت یا تکمیل‌شدنی را بدون شواهد واقعی ادعا نکن. چرخهٔ اشتراک باید در بک‌اند قابل اجرا و تست باشد؛ پرداخت آنلاین و پنل گرافیکی ادمین در این مخزن ساخته نمی‌شوند.

**پشتهٔ فنی قطعی این نسخه:** Flutter موبایل در مخزن جداگانه؛ بک‌اند این مخزن NestJS + TypeScript + Prisma + PostgreSQL. از Kotlin/Spring Boot یا Gradle برای بک‌اند استفاده نکن. Flutter/Dart فقط در مخزن موبایل خواهد بود.

---
## ✳️ اصلاحیهٔ قرارداد v0.4.0 (2026-11-04)

این سند (v3.0) مرجعِ فازهای ۰ تا ۷ است. پس از بازبینی دامنهٔ بازار افغانستان، قرارداد به **v0.4.0** ارتقا یافت و این افزونه‌ها به مدل داده اضافه شد (منبع حقیقت: `contracts/openapi.yaml` و `prisma/schema.prisma`؛ مستندات دامنه: `docs/product/*` و `docs/api/api-gap-analysis-v0.3.md`):

- **بستهٔ اقامت** `AccommodationPackage` + اجزای `ACCOMMODATION/BOARD/SERVICE` با پرچم `deductibleOnAbsence`؛ snapshot اجزا در `StayContract`.
- **غیابت موقت** `TemporaryAbsence` (وضعیت `REQUESTED/APPROVED/ADJUSTED/CLOSED`) + اتصال credit به `Charge` (نوع `ADJUSTMENT`).
- **پرداخت‌کنندهٔ جدا** (فیلدهای `payer*` روی `Payment`) — بدون موجودیت/حساب مستقل.
- **وضعیت نگهداری** اتاق/تخت `MaintenanceStatus` (جدا از وضعیت استفاده؛ اشغال از تخصیص استنتاج می‌شود).
- **تماس اضطراری** ساکن و **تنظیمات عملیاتی لیلیه** (سیاست غیابت `absenceMinDays` قابل‌تنظیم).

**ترتیب فازها (اصلاح‌شده):** ۸ = ساکن/پذیرش/قرارداد/تخصیص/انتقال/Check-out؛ ۹ = شارژ/پرداخت/ودیعه/مصارف + منطق بسته و غیابت؛ ۱۰ = گزارش/داشبورد/رسید/صندوق؛ ۱۱ = تعمیرات/نظافت/وضعیت عملیاتی.

---

# بخش A — دستور اصلی برای ایجنت برنامه‌نویسی

## 0. نقش تو و هدف نهایی

تو در این پروژه هم‌زمان نقش‌های زیر را داری:

- معمار ارشد نرم‌افزار و طراح مرزهای سیستم؛
- مهندس بک‌اند NestJS و TypeScript؛
- طراح دیتابیس رابطه‌ای PostgreSQL؛
- مهندس قراردادهای REST/OpenAPI به روش Contract-First؛
- مهندس امنیت API، احراز هویت و جداسازی دادهٔ سازمان‌ها؛
- مهندس منطق کسب‌وکار و گردش مالی؛
- مهندس آفلاین‌اول و همگام‌سازی دادهٔ موبایل؛
- مهندس آزمون خودکار، مهاجرت دیتابیس، مشاهده‌پذیری و آماده‌سازی انتشار؛
- مستندساز فنی مسئول ثبت فرضیات، تصمیم‌ها، ریسک‌ها و شواهد آزمایش.

وظیفهٔ تو فقط ساخت فایل‌های کد نیست. باید بک‌اندی بسازی که قابل اجرا، قابل آزمایش، امن در سطح متناسب با محصول، قابل نگهداری و آمادهٔ اتصال به فرانت‌اند آینده باشد.

**نتیجهٔ مورد انتظار:** یک بک‌اند واقعی و اجرایی برای ESKAN به همراه دیتابیس PostgreSQL، مهاجرت‌های نسخه‌دار، قرارداد رسمی OpenAPI، تست‌ها، مستندات راه‌اندازی، مدل مجوزها، APIهای مدیریت لیلیه و امور مالی، و APIهای همگام‌سازی برای اپ اندروید آفلاین‌اول.

نباید در پایان فقط یک طرح، چند کلاس نمونه یا اسکلت خالی تحویل بدهی. پس از تحلیل و تثبیت قراردادها، پیاده‌سازی واقعی همهٔ قابلیت‌های MVP، اجرای تست‌ها و اصلاح خطاها را تا رسیدن به یک Backend Release Candidate ادامه بده؛ مگر آن‌که ابزار یا نیازمندی مسدودکننده‌ای واقعاً مانع باشد.

## 1. تعریف محصول ESKAN

ESKAN یک سامانهٔ مدیریت لیلیه‌های خصوصی است که در یک سیستم واحد امکان مدیریت لیلیه‌های محصلین/دانشجویان و لیلیه‌های کارگران/کارمندان را می‌دهد. تفاوت این دو نوع در اطلاعات تکمیلی ساکن و شیوهٔ مدیریت کسب‌وکار است، نه در دو نرم‌افزار مستقل.

### 1.1 کاربران و نقش‌ها

- **مالک (OWNER):** صاحب سازمان/کسب‌وکار؛ کنترل کامل سازمان، تنظیمات و اعضا.
- **مدیر (ADMIN):** مدیریت عملیاتی لیلیه، ساکنان، اتاق‌ها و امور مالی مطابق مجوزها.
- **اپراتور (OPERATOR):** ثبت عملیات روزمره در محدودهٔ دسترسی؛ نباید مجاز به تغییر یا حذف بی‌ردپای اسناد قطعی باشد.
- **مشاهده‌گر (VIEWER):** فقط خواندن داده‌های مجاز؛ می‌تواند پس از تثبیت MVP فعال شود.

نقش‌ها باید در بک‌اند enforce شوند؛ پنهان‌کردن دکمه در آیندهٔ فرانت‌اند، مجوزدهی محسوب نمی‌شود.

### 1.2 مدل استفاده

- کلاینت اصلی آینده: اپلیکیشن موبایل با Flutter و Dart.
- دیتابیس محلی اپ: SQLite با Drift یا راهکار Flutter معادل؛ این بخش در این مخزن بک‌اند ساخته نمی‌شود.
- بک‌اند: REST API روی HTTPS در محیط production.
- دیتابیس مرکزی: PostgreSQL.
- اپ موبایل باید بتواند بخش مهمی از گردش کار را بدون اینترنت ادامه دهد؛ پس از وصل‌شدن شبکه، عملیات آفلاین از طریق API همگام می‌شوند.
- سرور منبع حقیقت برای نسخهٔ مرکزی داده‌ها و حل تعارض‌های همگام‌سازی است. دیتابیس محلی موبایل در زمان آفلاین می‌تواند دادهٔ موقت/منتظر همگام‌سازی داشته باشد.
- یک سازمان می‌تواند یک یا چند لیلیه داشته باشد.
- یک سازمان در نسخهٔ اول می‌تواند چند مدیر/کاربر مجاز داشته باشد، ولی امکانات دعوت و مدیریت پیشرفتهٔ کاربر تنها در حدی ساخته شود که در MVP مشخص شده است.
- محصول باید از ابتدا جداسازی tenant/organization را رعایت کند، تا اطلاعات یک مالک هرگز به مالک دیگر نشت نکند.

### 1.3 امکانات MVP که باید واقعاً کار کنند

1. ثبت حساب مالک و ایجاد سازمان؛ ورود، خروج، تمدید و لغو نشست؛
2. مدیریت پروفایل سازمان و لیلیه‌ها؛
3. مدیریت طبقات/اتاق‌ها و بسترها؛
4. ثبت ساکن با نوع `STUDENT`, `WORKER`, `OTHER`؛
5. ثبت قرارداد اقامت، کرایه، تاریخ شروع/پایان و وضعیت قرارداد؛
6. تخصیص و پایان تخصیص بستر، همراه با تاریخچه؛
7. ثبت صورتحساب/بدهی‌های ساکن؛
8. ثبت دریافت پول، پرداخت جزئی، تخصیص دریافت به صورتحساب، اعتبار تخصیص‌نیافته و رسید یکتا؛
9. ثبت تضمین/ودیعه به‌صورت جدا از کرایه و درآمد عادی؛
10. ثبت مصارف پرداخت‌شدهٔ لیلیه؛
11. نمایش حساب ساکن، بدهی، دریافت‌ها و تاریخچهٔ مالی؛
12. گزارش‌های پایه: اشغال بستر، ساکنان فعال، بدهی‌ها، دریافت‌ها و مصارف در یک دوره؛
13. ثبت audit برای عملیات حساس؛
14. API همگام‌سازی تغییرات سرور به موبایل با cursor پایدار، versioning و tombstone؛
15. پشتیبانی از idempotency و تشخیص تعارض برای درخواست‌های نوشتنی؛
16. طرح‌های اشتراک، دورهٔ آزمایشی ۳۰روزهٔ قابل‌تنظیم، plan entitlements، downgrade امن به طرح رایگان و APIهای مدیریتی برای فعال‌سازی دستی طرح پولی؛
17. audit کامل تغییرات اشتراک و ثبت تأیید پرداخت دستی، جدا از پرداخت‌های کرایه/ودیعهٔ ساکنان؛
18. تست‌های واحد، یکپارچگی PostgreSQL، قرارداد API، مجوزدهی، جداسازی سازمان و سناریوهای مالی/اشتراک؛
19. راهنمای نصب/اجرا، فایل‌های نمونهٔ config، Docker Compose برای توسعه، migration و دستورهای backup/restore دیتابیس سرور.

### 1.4 موارد خارج از MVP

این موارد را بدون تأیید صریح مالک محصول پیاده نکن:

- درگاه پرداخت خودکار، Google Play Billing، اتصال مستقیم به بانک یا Mobile Money؛ دریافت و ثبت دستی پرداخت اشتراک پس از بررسی انسانی در دامنهٔ بک‌اند است؛
- ارسال SMS یا OTP با سرویس بیرونی؛
- اپ جداگانهٔ ساکنان؛
- UI پنل وب/React؛ APIهای Platform Admin برای مدیریت اشتراک در MVP هستند، اما خود پنل وب ساخته نمی‌شود؛
- حسابداری دوطرفهٔ کامل، محاسبهٔ مالیات، اظهارنامه یا تضمین سود خالص؛
- تشخیص هویت، اسکن مدرک هویتی یا جمع‌آوری اطلاعات حساس غیرضروری؛
- میکروسرویس‌ها، Kafka، Redis، Kubernetes یا معماری چندلایهٔ غیرضروری؛
- GraphQL؛
- حذف دائمی اسناد مالی قطعی؛
- last-write-wins برای پرداخت، تخصیص بستر یا هر دادهٔ حساس؛
- قابلیت‌های نمایشی که به منطق و دیتابیس واقعی متصل نیستند.

ویژگی‌هایی مانند درخواست ترمیمات، خروجی CSV/PDF و اعلان سروری را تنها وقتی اضافه کن که در MVP scope تأیید شده باشند؛ اگر زمان/دامنه محدود بود، ابتدا هستهٔ اقامت و مالی را کامل کن.

## 2. اصول غیرقابل مذاکره

1. مخزن و محیط فعلی را پیش از تغییر بررسی کن.
2. هیچ فایل کاربر، migration یا دادهٔ موجود را بدون مجوز پاک نکن.
3. از `git reset --hard`, force push، حذف migration قبلی یا بازنویسی مخرب استفاده نکن.
4. پیش از کدنویسی دامنه، نیازمندی‌ها، فرضیات و پرسش‌های باز را ثبت کن؛ بخش‌های غیرمسدود را متوقف نکن.
5. هیچ قاعدهٔ مالی، سیاست کرایه یا رفتار مهمی را بی‌صدا حدس نزن. اگر نیازمندی نامعلوم است، فرض موقت، اثر و گزینه‌های آن را ثبت کن و در صورت امکان default امن و قابل تغییر بساز.
6. همهٔ ورودی‌ها در سرور اعتبارسنجی شوند. به کلاینت قابل اعتماد تکیه نکن.
7. همهٔ عملیات چندجدولی مالی/اقامت در تراکنش دیتابیس اجرا شوند.
8. اسناد مالی قطعی حذف/بازنویسی خاموش نشوند؛ اصلاح از راه reversal/adjustment قابل پیگیری انجام شود.
9. مانده‌ها باید از سوابق معتبر محاسبه شوند؛ هر cache یا projection باید قابل بازسازی و reconciliation باشد.
10. هیچ مبلغی با `Float` یا `Double` محاسبه یا ذخیره نشود؛ از `Float` و `Number` برای محاسبات مالی استفاده نکن. مبالغ را با PostgreSQL `NUMERIC(19,2)` و کتابخانهٔ decimal دقیق (مانند `decimal.js`) مدیریت کن؛ تبدیل به Number فقط برای نمایش غیرحساس و پس از بررسی مجاز است.
11. کلاینت نباید `organizationId` را به‌عنوان مرجع مجوز تعیین کند. هر سازمان انتخاب‌شده باید از نشست کاربر و membership سمت سرور تأیید شود.
12. کلاینت نمی‌تواند `role`, `ownerId`, `postedBy`, `createdAt` یا فیلدهای سیستمی را به اختیار خود تعیین کند.
13. همهٔ endpointها قرارداد، status code، schema خطا و نمونهٔ request/response داشته باشند.
14. هیچ secret، token، password، اطلاعات مالی غیرضروری یا PII در log ثبت نشود.
15. تست اجرا‌نشده را موفق گزارش نکن. تعداد تست یا coverage را جعل نکن.
16. ادعای «۱۰۰٪ کامل»، «بدون باگ» یا «کاملاً امن» ممنوع است. از معیارهای پذیرش و شواهد استفاده کن.
17. فرانت‌اند Flutter را نساز و فایل‌های موبایل یا دیتابیس محلی SQLite/Drift را در این مخزن پیاده‌سازی نکن؛ هدف این مخزن بک‌اند و قرارداد API است.
18. پس از هر فاز، گزارش پیشرفت را در `docs/project/progress.md` به‌روز کن و تست‌های همان فاز را اجرا کن.
19. تا زمانی که همهٔ معیارهای مربوط به MVP پاس نشده‌اند، وضعیت پروژه را Release Candidate اعلام نکن.
20. اگر محدودیت context یا وقت ایجاد شد، یک checkpoint قابل تکرار ثبت کن؛ کار انجام‌شده را دوباره‌کاری نکن و ادعای پایان نداشته باش.
21. وضعیت طرح و entitlements باید همیشه در بک‌اند enforce شود؛ مخفی‌کردن قابلیت در موبایل به‌تنهایی کنترل دسترسی نیست.
22. وضعیت اشتراک ESKAN و دریافت وجه برای استفاده از خود نرم‌افزار را هرگز با Charge/Payment/Deposit/Expense ساکنان لیلیه مخلوط نکن؛ آن‌ها دو حوزهٔ مالی و دو دفتر جدا هستند.
23. برای نسخهٔ Google Play، اپ را به‌صورت consumption-only طراحی کن: درون اپ checkout، دکمه یا لینک پرداخت جایگزین، دستور پرداخت، شماره/لینک قابل‌کلیک برای خرید یا هدایت مستقیم به روش پرداخت بیرونی پیاده نکن. کاربر می‌تواند در اپ وارد حسابی شود که اشتراکش بیرون از اپ فعال شده است. متن اطلاع‌رسانی طرح/پایان trial باید غیرتراکنشی و بدون لینک مستقیم پرداخت باشد؛ سیاست جاری Google Play پیش از انتشار نهایی جداگانه بررسی شود.

## 3. فناوری پایه و سیاست انتخاب نسخه

ترکیب فنی قطعی برای این نسخه:

- زبان بک‌اند: TypeScript با `strict: true`؛
- runtime: Node.js؛ نسخهٔ LTS فعال و سازگار با NestJS انتخاب و ثبت شود؛ نسخهٔ نصب‌شدهٔ توسعه‌دهنده در آغاز بررسی شود، اما فقط به‌دلیل نصب‌بودن انتخاب نشود؛
- framework: NestJS؛
- HTTP adapter: Express به‌عنوان پیش‌فرض؛ Fastify فقط با دلیل و تست سازگاری؛
- دیتابیس مرکزی: PostgreSQL؛
- ORM: Prisma؛ schema و migrations در مخزن نگهداری شوند؛
- migration: Prisma Migrate؛ در production از `prisma migrate deploy` استفاده شود؛ `db push` برای production ممنوع؛
- قرارداد API: OpenAPI به روش Contract-First؛ فایل `contracts/openapi.yaml` منبع قرارداد عمومی باشد؛
- validation: DTOهای NestJS با `class-validator` و `class-transformer` یا راهکار واحد معادل؛ تمام ورودی‌ها در runtime اعتبارسنجی شوند؛
- authentication: access token کوتاه‌عمر و refresh-token rotation با ذخیرهٔ امن hash توکن refresh در دیتابیس؛ انتخاب جزئیات در ADR؛
- password hashing: Argon2id یا گزینهٔ استاندارد امن با تنظیمات مستند؛ هرگز plaintext یا reversible encryption؛
- تست: Jest، Supertest، PostgreSQL واقعی در integration tests و Testcontainers در صورت سازگاری محیط؛
- lint/format: ESLint و Prettier با نسخه‌های pin شده؛
- local development: Docker Compose برای PostgreSQL؛ اگر PostgreSQL محلی موجود باشد، دستورهای اتصال جایگزین مستند شوند؛
- config: `@nestjs/config` یا پیکربندی رسمی معادل، schema validation در startup؛
- logs: logging ساختاریافته، redaction و request/correlation ID؛
- timestamps: ذخیرهٔ timestamp در PostgreSQL به‌شکل `timestamptz` و UTC؛ timezone پیش‌فرض کسب‌وکار `Asia/Kabul`؛
- پول: PostgreSQL `NUMERIC(19,2)`؛ در TypeScript از `decimal.js` یا نوع دقیق هم‌ارز استفاده کن و از محاسبات مالی با `Number` پرهیز کن؛ API مبلغ را به شکل string ده‌دهی همراه currency code منتقل کند؛
- API docs: اعتبارسنجی فایل OpenAPI و تطبیق آن با رفتار واقعی endpointها؛ Swagger UI فقط نمایش قرارداد است و منبع مستقل دوم نیست؛
- package manager: npm؛ `package-lock.json` باید commit شود و CI از `npm ci` استفاده کند.

### 3.1 انتخاب نسخه‌ها

نسخه‌ها را از حافظه یا عبارت `latest` حدس نزن. پیش از تثبیت پروژه:

1. مستندات رسمی Node.js، NestJS، TypeScript، Prisma، PostgreSQL، OpenAPI، Jest و ابزار validation را بررسی کن.
2. سازگاری Node.js، NestJS، Prisma Client/CLI، TypeScript، `class-validator`، adapter و نسخهٔ PostgreSQL را بررسی کن.
3. نسخهٔ stable و پشتیبانی‌شده انتخاب کن؛ نسخه‌ها را در `package.json` و `package-lock.json` ثبت کن.
4. از `npm install` غیرقابل بازتولید در CI پرهیز کن؛ CI باید از `npm ci` استفاده کند.
5. انتخاب نسخه و گزینه‌های ردشده را در ADR ثبت کن.
6. اگر نسخهٔ موجود Node.js با پشتیبانی رسمی وابستگی‌ها سازگار نیست، دلیل و مسیر اصلاح را گزارش کن؛ نسخهٔ runtime را بی‌دلیل عوض نکن.

## 3.2 معماری اولیه

از **Modular Monolith** استفاده کن؛ نه microservices. مرزهای ماژول‌ها باید واضح باشند. برای MVP از NestJS controllers، application services و Prisma استفاده کن؛ از event bus، CQRS کامل، microservices یا abstractionهای پیچیده مگر با دلیل ثبت‌شده استفاده نکن.

ساختار مفهومی هر feature:

- `api`: controller، DTO ورودی/خروجی، mapping HTTP؛
- `application`: use-case/service، orchestration و مرز تراکنش؛
- `domain`: قواعد اصلی کسب‌وکار و سیاست‌ها؛ مستقل از HTTP تا حد عملی؛
- `infrastructure`: Prisma queries/repositories، security adapters، clock و سرویس‌های خارجی.

NestJS moduleها باید feature-based و واضح باشند. از circular dependency و `forwardRef` به‌عنوان راه‌حل پیش‌فرض پرهیز کن. از ایجاد generic repository بی‌فایده یا interface برای هر کلاس صرفاً تشریفاتی خودداری کن. کنترلرها نباید منطق مالی، queryهای پراکنده یا سیاست مجوزدهی دامنه‌ای را مستقیماً اجرا کنند.

تراکنش‌های چندمرحله‌ای باید از Prisma transaction API استفاده کنند؛ عملیات حساس به هم‌زمانی باید با constraints، transaction isolation، row locking از طریق queryهای کنترل‌شده در صورت نیاز، optimistic version یا الگوی معتبر دیگر حفاظت شوند. صحت مالی را صرفاً به چک‌های قبل از transaction واگذار نکن.

# بخش B — فازهای اجرایی اجباری

هر فاز شامل هدف، کارها، فایل‌های تحویلی و معیار عبور است. به‌ترتیب کار کن؛ ولی اگر بخشی از فاز به سؤال دامنه‌ای غیرمسدود وابسته بود، سؤال را ثبت و بخش مستقل را پیش ببر. برای پایان یک فاز باید شواهد واقعی موجود باشد.

## فاز 0 — بررسی مخزن و خط پایه

### هدف
شناخت وضعیت موجود و جلوگیری از تغییر مخرب.

### کارها

1. مسیر فعلی، ساختار پوشه، branch، commit اخیر و `git status` را بررسی کن.
2. فایل‌های `README`, `package.json`, `tsconfig.json`, `package-lock.json`, application config، migrations و tests را بخوان.
3. نسخه‌های Node.js، npm، NestJS، TypeScript، Prisma، PostgreSQL و ابزارهای build را ثبت کن.
4. دستورهای موجود build، test، lint، formatting و database migration را اجرا کن، اگر قابل اجرا هستند.
5. خروجی خام شکست‌ها را ثبت کن؛ شکست قبلی را با شکست تازه قاطی نکن.
6. مشخص کن آیا مخزن برای ESKAN است یا پروژهٔ دیگری؛ کدهای پروژهٔ دیگر را بی‌اجازه ادغام نکن.
7. بررسی کن secrets یا دادهٔ واقعی ناخواسته در Git track شده‌اند؛ آن‌ها را بی‌اجازه حذف نکن، ولی ریسک را ثبت و راه امن اصلاح را پیشنهاد کن.
8. اگر مخزن خالی است، آن را صریح ثبت کن و پس از تکمیل تحلیل فازهای بعد اسکلت را بساز.

### خروجی‌ها

- `docs/project/repository-assessment.md`
- `docs/project/commands.md`
- `docs/project/risks-register.md`
- `docs/project/progress.md`
- جدول خط پایهٔ build/test/lint/migration با نتیجهٔ واقعی.

### معیار عبور
مخزن و محیط شناخته شده باشد؛ هر شکست اولیه ثبت شده باشد؛ هیچ فایل یا داده‌ای حذف نشده باشد.

## فاز 1 — تحلیل دامنه و نیازهای واقعی

### هدف
ترجمهٔ مفهوم لیلیه به گردش کاری صریح، قابل پیاده‌سازی و قابل آزمون.

### تعریف‌های دامنه‌ای

- `Organization`: مالکیت و مرز امنیتی یک کسب‌وکار؛
- `Hostel`: یک لیلیه متعلق به سازمان؛
- `Room`: اتاق داخل لیلیه؛
- `Bed`: بستر مشخص داخل اتاق؛
- `Resident`: شخص ساکن؛
- `StayContract`: قرارداد اقامت با شرایط مالی و تاریخ‌های مستقل؛
- `BedAssignment`: سابقهٔ تخصیص بستر؛
- `Charge`: تعهد مالی/صورتحساب‌شده؛
- `Payment`: دریافت وجه؛
- `PaymentAllocation`: تخصیص بخشی از دریافت به یک یا چند صورتحساب؛
- `DepositTransaction`: دریافت/برگشت/تعدیل ودیعه؛
- `Expense`: مصرف/هزینه‌ای که در MVP به‌عنوان هزینهٔ پرداخت‌شده ثبت می‌شود؛
- `AuditEvent`: سابقهٔ عملیات حساس؛
- `SyncChange`: اعلام تغییرات داده برای همگام‌سازی کلاینت‌ها؛
- `SubscriptionPlan`: کاتالوگ طرح و limits/features؛
- `OrganizationSubscription`: وضعیت Trial/اشتراک مؤثر هر سازمان؛
- `SubscriptionAuditEvent`: تاریخچهٔ تغییرات lifecycle؛
- `ManualSubscriptionPayment`: دریافت دستی بابت اشتراک ESKAN، جدا از مالیهٔ ساکنان.

### کارها

1. در `docs/domain/glossary-fa-AF.md` واژه‌های رایج و ترجیح‌شدهٔ دری را ثبت کن؛ متن API از زبان نمایشی مستقل باشد.
2. گردش‌های کار زیر را مستند کن:
   - ایجاد سازمان و اولین مدیر؛
   - ایجاد لیلیه، اتاق و بستر؛
   - ثبت ساکن؛
   - ایجاد قرارداد و تخصیص بستر؛
   - ثبت کرایه/صورتحساب؛
   - ثبت پرداخت کامل و قسطی؛
   - ثبت ودیعه و برگشت آن؛
   - ثبت مصارف؛
   - خروج ساکن و پایان قرارداد؛
   - تغییر بستر؛
   - ثبت/اصلاح عملیات در حالت آفلاین و رسیدن آن به سرور؛
   - گزارش‌گیری از بدهی و دریافت‌ها؛
   - دریافت وضعیت طرح/اشتراک و محدودیت‌های مؤثر سازمان؛
   - ایجاد trial، اعمال entitlements، downgrade امن به Free پس از پایان دوره، و فعال‌سازی/تمدید دستی اشتراک توسط Platform Admin مجاز؛
   - ثبت سابقهٔ تغییر طرح و پرداخت اشتراک دستیِ تأییدشده با audit قابل پیگیری.
3. فرضیات و ابهامات دربارهٔ ورود/خروج وسط ماه، تاریخ شروع دورهٔ کرایه، پرداخت اضافه، برگشت وجه و نقش‌ها را در `docs/domain/open-questions.md` ثبت کن.
4. برای MVP، قواعد امن و قابل تغییر زیر را اعمال کن مگر نیازمندی تأییدشده چیز دیگری بگوید:
   - قراردادهای معمول بر اساس کرایهٔ ماهانه؛
   - ایجاد صورتحساب ابتدا صریح و قابل کنترل باشد؛ تولید خودکار/روزانهٔ کرایه تا تثبیت سیاست prorating فعال نشود؛
   - صورتحساب گذشته با تغییر نرخ جاری خودکار عوض نشود؛
   - پرداخت اضافه به‌عنوان مبلغ تخصیص‌نیافته باقی بماند و بدهی منفی تولید نکند؛
   - ودیعه از کرایه و درآمد عملیاتی جدا باشد؛
   - هزینهٔ MVP به معنی هزینهٔ ثبت‌شده و پرداخت‌شده است؛ بدهی به تأمین‌کننده در MVP ساخته نشود مگر scope تأیید گردد؛
   - برگشت پرداخت با عملیات reversal و دلیل، نه پاک‌کردن رکورد اصلی؛
   - تاریخ‌های کاری به‌صورت `LocalDate` و زمان ثبت به‌صورت timestamp مستقل ثبت شوند.
5. مشخص کن چه فیلدهایی برای Resident واقعاً لازم‌اند. پیش‌فرض کمینه: نام کامل، نوع ساکن، شماره تماس اختیاری، وضعیت و یادداشت غیرحساس اختیاری. شمارهٔ ملی/تذکره، تصویر مدارک و اطلاعات حساس را بدون ضرورت روشن اضافه نکن.
6. نیازمندی‌های کارکردی و غیرکارکردی را در جداول `REQ-F-xxx` و `REQ-NF-xxx` با اولویت MUST/SHOULD/COULD ثبت کن.
7. هر نیازمندی باید آزمون پذیرش مرتبط داشته باشد.

### خروجی‌ها

- `docs/domain/glossary-fa-AF.md`
- `docs/domain/current-workflows.md` (اگر فرایند موجود از مالک مشخص نشده، این محدودیت را بنویس)
- `docs/domain/target-workflows.md`
- `docs/domain/requirements.md`
- `docs/domain/open-questions.md`
- `docs/domain/assumptions-register.md`
- `docs/domain/acceptance-scenarios.md`

### معیار عبور
حدود MVP، واژه‌نامه، ابهام‌های مالی، نقش‌ها و سناریوهای پذیرش مستند شده باشند. قواعد مالی حیاتی نباید بر فرض پنهان تکیه کنند.

## فاز 1.5 — Scope lock و معیارهای نسخهٔ اول

### هدف
جلوگیری از آن‌که ایجنت تمام امکانات آینده را بدون اولویت یک‌جا پیاده کند.

### MUST برای MVP

- auth و tenant isolation؛
- سازمان و لیلیه؛
- اتاق و بستر؛
- ساکن و قرارداد؛
- تخصیص/پایان تخصیص با جلوگیری از هم‌پوشانی؛
- Charge/Payment/Allocation/Reversal؛
- ودیعه؛
- Expense؛
- گزارش‌های پایه؛
- audit و idempotency؛
- Trial سی‌روزهٔ قابل‌تنظیم و انتقال امن به FREE؛
- مدل plan/feature/limit و enforcement در server؛
- APIهای Platform Admin برای activation/extension/suspension و ثبت دستی پرداخت تأییدشده؛
- تاریخچهٔ append-only برای تغییرات اشتراک؛
- Sync Pull و API مناسب برای queued writes؛
- OpenAPI کامل؛
- migrations و تست واقعی PostgreSQL؛
- Docker Compose و مستند راه‌اندازی؛
- تست جداسازی سازمان‌ها.

### SHOULD

- درخواست ترمیمات؛
- دعوت عضو با توکن یک‌بارمصرف؛
- export CSV امن؛
- فیلترهای پیشرفته و گزارش‌های تفصیلی.

### FUTURE

- درگاه پرداخت آنلاین/درون‌برنامه‌ای و اتصال بانک، SMS، اپ ساکن، UI پنل وب، گزارش حسابداری رسمی، webhook، چند ارز و قابلیت‌های تحلیلی پیشرفته. مدیریت چرخهٔ اشتراک و API مدیریتی آن MVP است؛ رابط گرافیکی پنل ادمین در scope آینده می‌ماند.

### کارها

1. `docs/product/mvp-scope.md` بساز.
2. هر endpoint و جدول را به نیازمندی MVP وصل کن.
3. قابلیت بدون requirement را حذف یا در backlog ثبت کن.
4. «کامل بودن» را بر اساس acceptance criteria تعریف کن؛ تعداد فایل یا endpoint معیار نیست.

### معیار عبور
scope ثابت باشد و تمام قابلیت‌های MUST معیار پذیرش داشته باشند.

## فاز 2 — معماری، تهدیدها و ADR

### هدف
تثبیت تصمیم‌های فنی پیش از تولید انبوه کد.

### ADRهای الزامی

- `ADR-0001-tech-stack-and-version-matrix.md`
- `ADR-0002-modular-monolith.md`
- `ADR-0003-postgresql-and-prisma.md`
- `ADR-0004-openapi-contract-first.md`
- `ADR-0005-authentication-and-sessions.md`
- `ADR-0006-tenant-isolation.md`
- `ADR-0007-offline-sync-and-conflicts.md`
- `ADR-0008-financial-records-and-reversals.md`
- `ADR-0009-time-money-and-locale.md`
- `ADR-0010-subscriptions-trials-and-manual-activation.md`

### کارها

1. یک یک technical spike کوتاه ایجاد کن تا اتصال NestJS/Prisma به PostgreSQL، تولید Prisma Client و اجرای Prisma Migrate ثابت شود.
2. یک endpoint آزمایشی با OpenAPI، اعتبارسنجی و خطای Problem Details بساز و تست کن.
3. تست کن که Testcontainers PostgreSQL در محیط توسعه/CI مورد نظر قابل اجراست.
4. دربارهٔ تولید مدل/API از OpenAPI تصمیم بگیر:
   - ابتدا بررسی کن آیا generator انتخاب‌شده با نسخهٔ قطعی NestJS/TypeScript سازگار است؛
   - OpenAPI باید منبع حقیقت قرارداد باقی بماند؛
   - اگر تولید server interface سازگار نبود، DTO/controllerهای دستی مجازند، اما lint و contract tests باید drift را آشکار کنند؛
   - هیچ specification موازی و متناقض نساز.
5. threat model را برای دسترسی بین سازمان‌ها، سرقت refresh token، brute force، mass assignment، replay، افشای PII، گزارش‌ها و همگام‌سازی بنویس.
6. تصمیمات را از نظر سادگی، هزینهٔ نگهداری، امنیت و امکان آزمون مقایسه کن. تصمیم را بی‌صدا تغییر نده.

### خروجی‌ها

- `docs/architecture/architecture-overview.md`
- `docs/architecture/data-flow.md`
- `docs/architecture/threat-model.md`
- پوشهٔ `docs/architecture/decisions/`
- نمودار Mermaid از runtime، ماژول‌ها و جریان sync.

### معیار عبور
Spike واقعی اجرا شده و انتخاب‌ها با دلیل، محدودیت و پیامد ثبت شده باشند.

## فاز 3 — قرارداد OpenAPI به روش Contract-First

### هدف
تولید قرارداد رسمی API پیش از تثبیت controllerها تا فرانت‌اند آینده بر اساس حدس ساخته نشود.

### منبع حقیقت

فایل مرجع: `contracts/openapi.yaml`.

نسخهٔ OpenAPI باید با ابزارهای انتخاب‌شده سازگار باشد. lint، validation و در صورت نیاز client generator را آزمایش کن. قرارداد `contracts/openapi.yaml` منبع حقیقت API است؛ خروجی Swagger UI و DTOهای پراکنده منبع مستقل دوم نیستند.

### قواعد عمومی API

1. همهٔ مسیرهای محصول زیر `/api/v1` باشند؛ health probes می‌توانند مسیر عملیاتی جدا داشته باشند.
2. JSON UTF-8؛ نام propertyها `camelCase`؛ enumها در JSON با رشته‌های uppercase ثابت.
3. شناسهٔ داخلی موجودیت‌ها UUID باشد؛ شمارهٔ رسید/سند تجاری شناسهٔ جدا و یکتا داشته باشد.
4. تمام عملیات نوشتنی با `Idempotency-Key` پشتیبانی شوند؛ برای تغییرات mutable نسخهٔ مورد انتظار/optimistic locking نیز لازم است.
5. `GET` نباید اثر مالی جانبی داشته باشد.
6. تمام فهرست‌ها pagination صریح داشته باشند؛ limit پیش‌فرض محدود و max limit مشخص باشد.
7. هر عملیات، permission لازم، status code، request schema، response schema، خطاها و نمونهٔ ساختگی داشته باشد.
8. خطاها با RFC 9457 Problem Details یا قالب ثابت و مستند مبتنی بر آن برگردند. `code` پایدار برنامه‌ای و `traceId` اضافه شود.
9. validation errors فهرست فیلد، code و پیام عمومی داشته باشند؛ stack trace، SQL، path سرور یا secret افشا نشود.
10. درخواست دارای فیلد ناشناخته رد شود یا رفتار ثابت و مستند داشته باشد؛ فیلدهای ناشناخته را بی‌صدا نادیده نگیر.
11. JSON number برای مبلغ استفاده نشود؛ amount در API string ده‌دهی مانند `"2000.00"` باشد، همراه `currency: "AFN"`.
12. timestamp با RFC 3339/ISO-8601 و UTC؛ تاریخ کاری به شکل `YYYY-MM-DD` و جدا از timestamp ثبت شود.
13. پاسخ موجودیت‌های قابل تغییر دارای `version` باشد. update با `expectedVersion` یا `If-Match` کنترل شود و تعارض به HTTP 409 منتهی گردد.
14. فیلدهای `createdAt`, `updatedAt`, `createdBy`, `postedAt`, `postedBy`, `organizationId` و وضعیت قطعی توسط سرور تعیین شوند مگر endpoint مشخصاً برای فیلد دیگری طراحی شده باشد.
15. REST API باید از کلاینت موبایل مستقل باشد؛ هیچ پاسخ مختص UI یا متن ثابت دری در مدل دامنه قرار نده.

### مسیرهای API مورد نیاز

مسیرها پیشنهادهای پایه‌اند؛ آن‌ها را با requirements تطبیق بده، ولی بخش ضروری بدون توضیح حذف نشود.

#### System

- `GET /api/v1/system/version`
- `GET /api/v1/system/me`
- `GET /health/live`
- `GET /health/ready`

Health endpoint نباید اطلاعات حساس دیتابیس یا config را بیرون بدهد. فقط endpointهای health ضروری با allow-list مشخص expose شوند.

#### Authentication

- `POST /api/v1/auth/register` — ایجاد حساب مالک و سازمان در یک transaction، در صورتی که ثبت آزاد مطابق config فعال باشد؛
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`

Registration باید از نظر abuse محدود شود. در production امکان خاموش‌کردن public registration وجود داشته باشد. ثبت کاربر و ایجاد سازمان نباید نیمه‌کاره بماند.

#### Organization/Profile

- `GET /api/v1/organizations/current`
- `PATCH /api/v1/organizations/current`
- `GET /api/v1/organizations/current/members`
- `POST /api/v1/organizations/current/members` یا invitation flow فقط اگر MVP آن را شامل می‌کند؛
- `PATCH /api/v1/organizations/current/members/{membershipId}` برای تغییر نقش/فعالیت با کنترل مالک.

`organizationId` فعال باید از context احراز هویت‌شده و membership مجاز به‌دست آید؛ header `X-Organization-Id` صرفاً selector است، نه مجوز.

#### Hostels / Rooms / Beds

- `GET/POST /api/v1/hostels`
- `GET/PATCH /api/v1/hostels/{hostelId}`
- `POST /api/v1/hostels/{hostelId}/archive`
- `GET/POST /api/v1/hostels/{hostelId}/rooms`
- `GET/PATCH /api/v1/rooms/{roomId}`
- `POST /api/v1/rooms/{roomId}/archive`
- `GET/POST /api/v1/rooms/{roomId}/beds`
- `GET/PATCH /api/v1/beds/{bedId}`
- `POST /api/v1/beds/{bedId}/deactivate`

حذف اتاق/بستر دارای تاریخچه یا assignment فعال باید رد شود؛ برای دادهٔ مرجع از archive/deactivate استفاده کن.

#### Residents

- `GET/POST /api/v1/residents`
- `GET/PATCH /api/v1/residents/{residentId}`
- `GET /api/v1/residents/{residentId}/timeline`
- `GET /api/v1/residents/{residentId}/account`
- `POST /api/v1/residents/{residentId}/archive` فقط اگر هیچ قرارداد/بدهی فعال مانع آن نباشد.

فهرست باید جست‌وجوی امن، pagination، sort allow-list شده و filterهای مستند داشته باشد؛ sort field را مستقیم در SQL قرار نده.

#### Contracts and Bed Assignments

- `GET/POST /api/v1/contracts`
- `GET/PATCH /api/v1/contracts/{contractId}` تا پیش از فعال/نهایی‌شدن مطابق قواعد مجاز؛
- `POST /api/v1/contracts/{contractId}/activate`
- `POST /api/v1/contracts/{contractId}/terminate`
- `POST /api/v1/bed-assignments`
- `POST /api/v1/bed-assignments/{assignmentId}/end`
- `GET /api/v1/residents/{residentId}/assignments`

حالت‌های قرارداد و transitionهای مجاز را مستند و enforce کن. قرارداد فعال باید بازهٔ اقامت و نرخ ثابت خودش را ثبت کند. تغییر نرخ جاری نباید صورتحساب‌های پیشین را عوض کند.

#### Charges / Payments / Deposits

- `GET/POST /api/v1/charges`
- `GET /api/v1/charges/{chargeId}`
- `POST /api/v1/charges/{chargeId}/reverse`
- `GET/POST /api/v1/payments`
- `GET /api/v1/payments/{paymentId}`
- `POST /api/v1/payments/{paymentId}/reverse`
- `GET /api/v1/residents/{residentId}/payments`
- `GET /api/v1/residents/{residentId}/account`
- `GET /api/v1/residents/{residentId}/deposit-transactions`
- `POST /api/v1/residents/{residentId}/deposit-transactions` با نوع رویداد مشخص و مجوز مناسب (`RECEIVED`, `REFUNDED`, `FORFEITED`)
- `POST /api/v1/deposit-transactions/{depositTransactionId}/reverse` برای اصلاح رویداد ثبت‌شدهٔ اشتباه؛ این endpoint با refund عادی فرق دارد.

ثبت دریافت، تخصیص به صورتحساب و رویداد sync باید در یک transaction انجام شود. درخواست پرداخت باید شناسهٔ idempotency داشته باشد. پرداخت نمی‌تواند بدون سیاست روشن بیش از مقدار دریافت به صورتحساب‌ها تخصیص یابد.

#### Expenses

- `GET/POST /api/v1/expenses`
- `GET /api/v1/expenses/{expenseId}`
- `POST /api/v1/expenses/{expenseId}/reverse`

MVP فقط هزینهٔ ثبت‌شده/پرداخت‌شده را پوشش می‌دهد؛ تعهد به تأمین‌کننده و حساب پرداختنی در scope آینده است مگر صریحاً تصویب شود.

#### Maintenance (در صورت شمول MVP)

- `GET/POST /api/v1/maintenance-requests`
- `GET/PATCH /api/v1/maintenance-requests/{requestId}`
- transitionهای status باید محدود و تست‌شده باشند.

#### Reports

- `GET /api/v1/reports/dashboard`
- `GET /api/v1/reports/occupancy`
- `GET /api/v1/reports/receivables`
- `GET /api/v1/reports/financial-summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/reports/expenses?from=...&to=...`
- `GET /api/v1/reports/residents/{residentId}/statement?from=...&to=...`

گزارش باید بر مبنای اسناد و allocationهای معتبر باشد. تفاوت بین مبلغ صورتحساب‌شده، وجه وصول‌شده، ودیعه و مصرف نقدی صریح باشد. «سود خالص» یا حسابداری رسمی را بدون سیاست حسابداری مصوب نمایش نده.

#### Sync

- `POST /api/v1/sync/devices/register`
- `GET /api/v1/sync/changes?afterSequence={cursor}&limit={n}`
- `GET /api/v1/sync/status`
- `POST /api/v1/sync/resync-request` فقط در صورت نیاز به full resync.

نوشتن آفلاین از طریق queue کلاینت انجام می‌شود و هنگام وصل‌شدن، همان endpointهای mutation با `Idempotency-Key` و version/expectedVersion ارسال می‌شوند؛ API عمومی و مخرب برای اجرای SQL یا patch دلخواه روی هر entity نساز.

### مدل پاسخ عمومی

نمونهٔ موفق:

```json
{
  "data": {
    "id": "00000000-0000-4000-8000-000000000001"
  },
  "meta": {
    "traceId": "example-trace-id"
  }
}
```

این فقط شکل کلی است؛ برای هر endpoint schema کامل و دقیق بنویس. لازم نیست تمام پاسخ‌ها به زور در یک wrapper باشند، ولی قرارداد کلی باید یکسان، مستند و قابل استفاده باشد.

نمونهٔ خطا:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "The resource has changed since it was read.",
  "instance": "/api/v1/beds/00000000-0000-4000-8000-000000000001",
  "code": "RESOURCE_VERSION_CONFLICT",
  "traceId": "example-trace-id"
}
```

نمونه‌ها ساختگی‌اند. مدل نهایی باید بر اساس Problem Details و extensionهای ثابت پیاده و در OpenAPI تعریف شود.

### خروجی‌های فاز

- `contracts/openapi.yaml`
- `docs/api/api-conventions.md`
- `docs/api/error-model.md`
- `docs/api/idempotency.md`
- `docs/api/permissions-matrix.md`
- `docs/api/offline-sync.md`
- نمونه‌های request/response و script اعتبارسنجی/lint قرارداد.

### معیار عبور
OpenAPI معتبر و lint‌شده باشد؛ routeها و schemaهای ضروری تعریف شده باشند؛ operationId تکراری وجود نداشته باشد؛ روش تولید کلاینت و سیاست breaking change روشن باشد.

## فاز 4 — ایجاد اسکلت پروژه و quality gates

### کارها

1. ساخت پروژه با npm scripts و TypeScript و `npm` قابل اجرا روی Windows و Linux.
2. نام بسته و namespace پایدار، مثلاً `@eskan/backend` و aliasهای TypeScript فقط در صورت پیکربندی درست در تست و build.
3. ماژول‌های مشخص در یک برنامهٔ NestJS، نه چند سرویس مستقل.
4. تنظیم profileهای `local`, `test`, `prod`؛ config type-safe و validation در startup.
5. `docker-compose.yml` برای PostgreSQL توسعه با volume پایدار، healthcheck و credentials صرفاً توسعه‌ای.
6. `.env.example` بدون secret واقعی؛ `.gitignore` مناسب برای `.env`, logs, build output، report و dumps.
7. npm scripts روشن و مستند: `build`, `test`, `test:e2e`, `lint`, `format:check`, `openapi:validate`, `db:generate`, `db:migrate:deploy`, `db:status` و `start:dev`.
8. تنظیم formatter/linter؛ disable کردن ruleها فقط با دلیل مستند.
9. logging ساختاریافته و correlation/trace id.
10. global exception handler با mapping پایدار به Problem Details.
11. validation سراسری و رد fieldهای ناشناخته در ورودی‌های DTO.
12. health/readiness محدود؛ فقط endpointهای لازم و بدون افشای secret.
13. CI یا script قابل اجرای محلی که build، lint، test و OpenAPI validation را اجرا کند.
14. test data/fixtures ساختگی؛ هیچ نام، شماره تماس یا اطلاعات واقعی استفاده نشود.

### خروجی‌ها

- `README.md`
- `docs/development/setup.md`
- `docs/development/testing.md`
- `.env.example`
- `docker-compose.yml`
- build/test scripts یا CI workflow.

### معیار عبور
روی محیط پاک با دستورهای README بتوان وابستگی‌ها را نصب، PostgreSQL توسعه را شروع و build/test پایه را اجرا کرد. هر فرمان واقعاً اجرا شود.

## فاز 5 — طراحی دیتابیس و مهاجرت‌ها

### اصول عمومی

- از PostgreSQL واقعی استفاده کن؛ H2 را جایگزین PostgreSQL در integration test نکن.
- schema تغییرات را فقط با Prisma Migrate migrations مدیریت کن؛ `prisma db push` در production ممنوع؛ migrationهای ثبت‌شده و review‌شده با `prisma migrate deploy` اجرا شوند.
- migration منتشرشده immutable است؛ اصلاح با migration جدید انجام شود.
- foreign keys، unique constraints، check constraints و indexes را برای invariants اساسی تعریف کن.
- جداول متعلق به سازمان باید مرز tenant روشن داشته باشند؛ هر reference بین موجودیت‌ها باید ثابت کند رکورد والد هم متعلق به همان سازمان است.
- از `ON DELETE CASCADE` برای اسناد مالی یا سابقهٔ اقامت استفاده نکن.
- `created_at`, `updated_at`, `created_by`، `updated_by` و در موارد لازم `posted_at`, `posted_by`, `version` داشته باش.
- فیلدهای audit و security را از mass assignment مصون نگه دار.
- `UUID` برای شناسهٔ داخلی؛ شماره رسید/سند از sequence دامنه‌ای جداگانه با transaction/constraint یکتا تولید شود.
- index براساس queryهای واقعی و گزارش‌ها؛ ایندکس‌سازی کور انجام نده.
- برای tenant-owned entities، در صورت مناسب بودن از ترکیب `organization_id` در FK/unique constraintها استفاده کن تا ارتباط بین دو سازمان غیرممکن شود.

### موجودیت‌های پایه

حداقل موجودیت‌های نامزد زیر را با نیازمندی‌ها تطبیق بده؛ فهرست مجوز ساخت همهٔ آن‌ها بدون تحلیل نیست:

1. `users`
2. `organizations`
3. `organization_memberships`
4. `refresh_sessions` یا `refresh_tokens`
5. `hostels`
6. `rooms`
7. `beds`
8. `residents`
9. `stay_contracts`
10. `bed_assignments`
11. `charges`
12. `payments`
13. `payment_allocations`
14. `deposit_transactions`
15. `expenses`
16. `maintenance_requests` در صورت شمول MVP
17. `audit_events`
18. `idempotency_records`
19. `sync_devices`
20. `organization_sync_state`
21. `sync_changes`
22. `subscription_plans`
23. `organization_subscriptions`
24. `subscription_audit_events`
25. `manual_subscription_payments`
26. جدول/مدل Platform Admin و نشست آن، یا استفادهٔ امن از users با system-level role صریح و مجزا از membership سازمان

### قواعد کلیدی schema

- برای تمام جدول‌های tenant-owned، `organization_id` یا یک راهکار روشن و قابل اثبات برای tenant scoping داشته باش.
- UUIDهای entityهای فرزند را به‌تنهایی کافی ندان؛ هر request باید رابطهٔ آن‌ها با سازمان فعال را بررسی کند.
- unique constraints برای ایمیل/username/phone را مطابق سیاست هویت واقعی تعیین کن؛ شماره تلفن ممکن است اختیاری یا غیر یکتا باشد، پس آن را بدون تأیید سراسری unique نکن.
- soft archive فقط برای master data که حذف آن سابقه را مخدوش نمی‌کند؛ مالی/قراردادی با state/reversal مدیریت شود.
- برای `amount` از `NUMERIC(19,2)` استفاده کن؛ currency code به‌صورت `CHAR(3)` یا enum سازگار نگهداری شود. اگر واحد ده‌دهی ارز تغییر کند، سیاست precision باید صریح باشد.
- برای شماره تلفن normalize محافظه‌کارانه؛ ورودی اصلی را بی‌دلیل از بین نبر و مقدار نمایشی/normalized را در صورت نیاز جدا نگه دار.
- زمان سیستم: `Instant`/`TIMESTAMPTZ`؛ تاریخ کاری: `DATE`. timezone نمایش با timestamp ذخیره‌شده اشتباه نشود.
- optimistic lock از راه فیلد `version` در موجودیت‌های mutable و بررسی نسخهٔ مورد انتظار در عملیات update.
- استثنای دیتابیس نباید مستقیماً به متن HTTP تبدیل شود؛ mapping امن و قابل پیش‌بینی بساز.

### جلوگیری از تخصیص هم‌پوشان بستر

یک بستر نباید در بازهٔ زمانی متداخل به دو قرارداد/ساکن تخصیص یابد.

- تعریف بازهٔ تخصیص به‌صورت `[startDate, endDate)`؛ `endDate` تهی به معنی ادامهٔ بازه است.
- علاوه بر validation دامنه، روش جلوگیری از race condition را طراحی کن.
- ترجیح: PostgreSQL exclusion constraint با daterange و `btree_gist`، مشروط بر این‌که extension در محیط هدف پشتیبانی شود؛ یا روش جایگزین قابل اثبات با قفل‌کردن row بستر در transaction و query conflict. انتخاب و محدودیت آن را در ADR ثبت کن.
- تست هم‌زمانی دو درخواست برای همان بستر را بنویس؛ فقط تست sequential کافی نیست.

### خروجی‌ها

- `docs/database/schema-overview.md`
- `docs/database/data-dictionary.md`
- migrationهای نسخه‌دار Prisma Migrate
- ER diagram (Mermaid یا ابزار مناسب)
- تست migration از دیتابیس خالی و ارتقای نسخهٔ قبلی.

### معیار عبور
migration fresh و upgrade پاس شود؛ FKها و constraints در PostgreSQL واقعی تأیید شوند؛ integrity check و تست‌های invariant موفق باشند.

## فاز 6 — احراز هویت، نشست و جداسازی سازمان

### Authentication

1. ثبت مالک در transaction واحد: ایجاد user + organization + membership با role `OWNER`.
2. ثبت آزاد سازمان باید config-controlled باشد؛ امکان خاموش‌کردن آن در production وجود داشته باشد.
3. ذخیرهٔ رمز فقط با password encoder معتبر و configurable؛ متن واضح password ممنوع.
4. login response access token کوتاه‌عمر و refresh token بلندعمر/opaque یا روش استاندارد هم‌سطح ارائه کند؛ token lifecycle و revoke روشن باشد.
5. refresh token در دیتابیس به‌شکل hash امن ذخیره شود، نه متن خام. rotation انجام شود؛ reuse یک refresh token منقضی/مصرف‌شده باید مطابق policy نشست را revoke یا رد کند.
6. logout نشست جاری را revoke کند؛ logout-all همهٔ نشست‌های کاربر را لغو کند.
7. errorهای ورود نباید وجود/عدم وجود username را بی‌جهت افشا کنند.
8. login throttling/rate limiting و قفل موقت بر اساس policy لازم است؛ از قفل دائمی ساده‌ای که کاربر را به‌آسانی DoS می‌کند خودداری کن.
9. secretهای JWT/signing از environment/secret manager بیایند؛ هیچ secret در Git یا artifact build نباشد.
10. expiration، rotation، issuer، audience، clock skew و algorithm allow-list دقیق پیکربندی شوند.

### Authorization و tenant isolation

1. role و membership فعال هر request بررسی شود.
2. درخواست سازمانی باید سازمان فعال را انتخاب کند، ولی سرور membership و فعال‌بودن آن را از DB/امنیت تأیید کند.
3. هیچ endpoint نباید فقط با UUID کار کند و tenant ownership را نسنجد.
4. برای تمام endpointهای `GET`, `POST`, `PATCH`, `DELETE/archive`, reports و sync تست BOLA/IDOR بنویس.
5. برای ساخت موجودیت، `organizationId` از security context وارد شود؛ از body قابل کنترل client گرفته نشود.
6. role permission matrix enforce شود؛ مالک/مدیر/اپراتور تفاوت واقعی داشته باشند.
7. حذف یا تنزل آخرین OWNER سازمان ممنوع باشد مگر انتقال مالکیت اتمیک و واضح انجام شود.
8. فیلدهای حساس فقط برای role مجاز برگردند؛ DTO جدا برای list/detail در صورت ضرورت.

### مدل نقش پیشنهادی

- `OWNER`: full control در سازمان خودش، مدیریت اعضا و عملیات مالی حساس.
- `ADMIN`: مدیریت عملیات روزانه و گزارش‌ها؛ مدیریت مالکیت/آخرین مالک ممنوع.
- `OPERATOR`: ثبت ساکن، قرارداد، تخصیص، دریافت، مصارف در محدودهٔ مجاز؛ reversal یا تغییر تنظیمات امنیتی نیازمند مجوز بالاتر.
- `VIEWER`: read-only.

اگر سطح جزئی‌تر نیاز نبود، permission framework خیلی پیچیده نساز؛ اما تمام use-caseها باید permission مشخص داشته باشند.

### خروجی‌ها

- `docs/security/authentication.md`
- `docs/security/authorization.md`
- `docs/api/permissions-matrix.md`
- تست login, refresh rotation, logout, expiry, invalid token, membership revoked, cross-tenant access و role matrix.

### معیار عبور
هیچ مسیر شناخته‌شده‌ای برای دسترسی میان‌سازمانی یا دورزدن role وجود نداشته باشد؛ تمام تست‌های مجوزدهی پاس شوند.

## فاز 7 — ماژول سازمان، لیلیه، اتاق و بستر

### قابلیت‌ها

- ایجاد/مشاهده/ویرایش/آرشیف لیلیه؛
- نوع فعالیت یا یادداشت‌های تنظیماتی در حد لازم؛ نوع دانشجو/کارگر به ساکن تعلق دارد، نه اینکه دو مدل مجزا از hostel بسازی؛
- اتاق با شماره/کد، طبقه، ظرفیت یا اطلاعات ضروری؛
- بستر با کد/نام داخل اتاق؛
- جلوگیری از تکرار شماره اتاق در یک لیلیه و کد بستر در یک اتاق؛
- جلوگیری از archive اتاق/بستر دارای assignment فعال؛
- pagination، filtering و sort allow-list؛
- تغییرات دارای audit و SyncChange.

### قواعد

- `room` متعلق به یک `hostel` و `bed` متعلق به یک `room` است؛ رابطه‌ها باید tenant-consistent باشند.
- ظرفیت اتاق باید با تعداد بسترهای فعال/قواعد تأییدشده سازگار باشد؛ تعریف دقیق ظرفیت را در مدل روشن کن.
- خالی/اشغال بودن بستر از assignmentها محاسبه یا projection قابل بازسازی باشد؛ تنها `isOccupied` mutable را به‌عنوان حقیقت ذخیره نکن.
- هنگام update، expected version بررسی شود.

### معیار عبور
تست CRUD، duplicate code، parent-tenant mismatch، archive با assignment فعال، search/pagination و sync events موفق باشند.

## فاز 8 — ساکنان، قرارداد و تخصیص بستر

### Resident

- نوع ساکن enum: `STUDENT`, `WORKER`, `OTHER`؛
- نام کامل لازم؛ شماره تماس در صورت ارائه؛ فیلدهای اختیاری فقط با نیاز روشن؛
- statusهای روشن نظیر `ACTIVE`, `INACTIVE`؛ state machine را ثبت کن؛
- جست‌وجو روی نام و شماره normalized با pagination؛
- تاریخچهٔ قرارداد و بستر از بین نرود.

### StayContract

حداقل فیلدها:

- `id`, `organizationId`, `hostelId`, `residentId`؛
- `contractNumber` یکتا در محدودهٔ سازمان؛
- `startDate`, `endDate` (اگر پایان تعریف شده باشد)؛
- `rentAmount`, `currency`, `billingCycle`؛
- `depositAmount` یا مقدار مورد انتظار ودیعه، بدون اشتباه گرفتن آن با دریافت واقعی؛
- `status` با transitionهای روشن: `DRAFT`, `ACTIVE`, `TERMINATED`, `CLOSED` یا مدل نهایی مستند؛
- snapshot شرایط مالی زمان عقد؛
- actor/time/audit fields و version.

تغییرات بعد از فعال‌شدن قرارداد باید طبق policy انجام شود؛ نرخ جدید نباید گذشته را بازنویسی کند. قرارداد قطعی حذف فیزیکی نشود.

### BedAssignment

- `bedId`, `residentId`, `contractId`, `startDate`, `endDate`, `status`, `version`؛
- تاریخ پایان در صورت تعریف‌شدن باید بعد از تاریخ شروع باشد؛
- بازه‌ها `[startDate, endDate)`؛
- جلوگیری از overlap برای همان bed در DB/transaction؛
- ساکن باید در قرارداد/سازمان معتبر باشد؛
- ending assignment باید idempotent یا conflict-safe باشد؛
- تغییر اتاق با پایان assignment قبلی و ایجاد assignment جدید انجام شود، نه بازنویسی تاریخچه.

### خروجی‌ها

- API/DTO/service/repository مربوط؛
- tests با overlap, same-day handoff, empty range, tenant mismatch, inactive contract و change history.

### معیار عبور
هیچ ساکن/بستری نمی‌تواند از راه endpointهای عادی شرایط دامنه را دور بزند؛ concurrency test برای assignment پاس شود.

## فاز 9 — صورتحساب، دریافت، تخصیص و ودیعه

این حساس‌ترین فاز پروژه است. آن را قبل از تست دستی مالی اعلام‌شده تمام‌شده تلقی نکن.

### 9.1 Charge — تعهد مالی

- مبلغ قابل پرداخت برای یک دوره/خدمت؛
- فیلدهای اصلی: organization, resident, contract optional حسب نوع charge, type, period start/end, amount, currency, dueDate, status, createdBy, postedAt, reversal reference, version;
- نوع حداقلی: `RENT`, `UTILITY`, `DAMAGE`, `OTHER`؛ types باید قابل محدودسازی و مستند باشند؛
- مبلغ مثبت یا طبق schema domain؛ صفر/منفی تنها اگر use-case صریح و آزمون‌شده‌ای وجود داشته باشد؛
- صورتحساب قطعی با نرخ همان زمان snapshot شود؛
- جلوگیری از duplicate charges برای همان قرارداد/نوع/دوره با business uniqueness روشن؛
- سیاست proration تا زمانی که تأیید نشده، به‌طور خودکار حدس زده نشود. endpoint ایجاد charge صریح باشد؛ billing automation آینده است.

### 9.2 Payment — دریافت واقعی پول

- مبلغ واقعی دریافتی، تاریخ دریافت، روش (`CASH`, `BANK_TRANSFER`, `MOBILE_MONEY`, `OTHER`)، شمارهٔ رسید، resident، وضعیت، actor، زمان ثبت و idempotency identity؛
- روش پرداخت فقط اطلاعات ثبت‌شده است؛ API به معنی اتصال بانکی/دریافت آنلاین نیست؛
- شماره رسید قابل خواندن برای انسان و شناسه داخلی UUID جدا باشد؛ یکتایی در سازمان اعمال شود؛
- reversal باید دلیل، actor، زمان و reference به payment اصلی داشته باشد؛ رکورد اصلی حفظ شود؛
- تلاش مجدد با همان idempotency key و همان payload باید همان نتیجه را بدهد؛ همان key با payload متفاوت باید با 409 رد شود.

### 9.3 PaymentAllocation

- allocation نشان می‌دهد چه مقدار از یک payment برای کدام charge مصرف شده؛
- هر allocation به payment و charge متعلق به همان organization وصل باشد؛
- مجموع allocationهای فعال از amount معتبر پرداخت بیشتر نشود؛
- charge reversal/payment reversal allocationهای مرتبط را طبق یک transaction امن اصلاح/معکوس کند؛
- مقدار تخصیص‌نیافته به‌عنوان credit/unallocated balance باقی بماند و به‌طور خودکار به صورتحسابی که کاربر تعیین نکرده تخصیص داده نشود؛
- ماندهٔ بدهی از chargeهای قطعی منهای allocationهای معتبر و تعدیلات رسمی محاسبه شود.

### 9.4 Deposit — ودیعه/تضمین

ودیعه را با کرایه یا درآمد عادی یکی نکن.

- ثبت `RECEIVED`, `REFUNDED`, `FORFEITED` یا رویداد معادل با amount مثبت و type مشخص؛
- ماندهٔ ودیعه از ledger رویدادها محاسبه شود؛
- برگشت بیش از مانده رد شود؛
- ضبط/کسر ودیعه نیاز به دلیل و مجوز داشته باشد؛
- اگر برای کسر ودیعه لازم است ساکن بدهی داشته باشد، charge یا adjustment مرتبط به‌صورت صریح ثبت شود؛ رفتار را پنهانی اجرا نکن.

### 9.5 قواعد تراکنشی

- ثبت payment + allocations + idempotency record + audit + sync change در transaction مناسب؛
- خطا در هر مرحله باید همهٔ اثرهای مالی همان درخواست را rollback کند؛
- دو درخواست هم‌زمان برای allocation یا reversal نباید مانده را زیر صفر یا double-allocate کنند؛ از lock/version/constraint متناسب استفاده کن؛
- پرداخت‌های posted حذف نمی‌شوند؛ اصلاح از reversal و ثبت درست تازه؛
- دریافتی/نقد وصول‌شده و مبلغ صورتحساب‌شده دو گزارش متفاوت‌اند؛
- گزارش مالی MVP را حسابداری دوطرفه یا سود خالص نام‌گذاری نکن.

### سناریوی آزمون الزامی

1. charge مقدار 10000.00 AFN ساخته شود؛
2. payment به مقدار 4000.00 AFN ثبت و allocate شود؛ مانده 6000.00 AFN باشد؛
3. payment دوم 3000.00 AFN ثبت/allocate شود؛ مانده 3000.00 AFN باشد؛
4. تخصیص 4000.00 از یک payment 3000.00 باید رد شود؛
5. اجرای دوبارهٔ همان payment request با همان idempotency key نباید payment دوم بسازد؛
6. همان key با body متفاوت باید conflict بدهد؛
7. reversal با دلیل ثبت شود، سابقهٔ اصلی باقی بماند و مانده دوباره محاسبه شود؛
8. دریافت ودیعه در گزارش کرایه/دریافت کرایه ادغام نشود؛
9. دو allocation هم‌زمان نتوانند بیش از amount معتبر پرداخت مصرف کنند؛
10. organization A نتواند payment/charge سازمان B را allocate کند.

### معیار عبور
تست‌های واحد و integration مالی روی PostgreSQL واقعی پاس شوند؛ reconciliation مستقل ماندهٔ هر resident را تأیید کند.

## فاز 10 — مصارف و گزارش‌های پایه

### Expenses

- MVP: هزینهٔ ثبت‌شده و پرداخت‌شده؛ بدهی تأمین‌کننده در scope نیست مگر تصویب شود؛
- category، amount، currency، business date، description کمینه، payment method، hostel اختیاری/مربوط، actor، status و reversal؛
- هزینهٔ posted پاک نمی‌شود؛ با reversal اصلاح می‌شود؛
- گزارش بر اساس تاریخ، category و hostel فیلتر شود.

### Reports

- dashboard: تعداد لیلیه، اتاق/بستر فعال، ظرفیت، اشغال، ساکنان فعال، صورتحساب‌های سررسیدشده و ماندهٔ بدهی؛
- occupancy: شمار بستر فعال، اشغال، خالی، و درصد اشغال با مخرج تعریف‌شده؛
- receivables: resident، charge، مانده، due date؛
- financial summary: chargeهای ایجادشده، paymentهای وصول‌شده/برگشت‌شده، allocationها، ودیعه، مصارف و مانده‌ها به‌صورت جدا؛
- statement ساکن: اسناد و دریافت‌ها در بازهٔ تاریخ، با شروع/پایان قابل reconciliation.

### قواعد

1. تمام گزارش‌ها باید tenant scope داشته باشند.
2. پارامتر تاریخ، timezone و شمول ابتدا/انتهای بازه روشن باشد؛ ترجیح `from` شامل و `to` شامل بر اساس business date یا بازهٔ نیمه‌باز را مستند کن.
3. گزارش‌ها نباید در GET اسناد مالی جدید بسازند.
4. برای جمع‌ها از decimal.js یا نوع دقیق معادل و SQL NUMERIC استفاده شود؛ هیچ محاسبهٔ مالی با JavaScript Number انجام نشود.
5. اگر summary cache شد، روش refresh و reconciliation ثبت شود؛ در MVP ترجیحاً گزارش ساده را از جداول اصلی محاسبه کن تا از ناسازگاری جلوگیری شود.
6. همهٔ sort/filterها allow-list باشند.

### معیار عبور
نتیجهٔ گزارش با query مستقل/test oracle روی مجموعه دادهٔ آزمایشی برابر باشد؛ تاریخ مرزی، دورهٔ خالی، reversal و tenant isolation تست شوند.

## فاز 11 — Idempotency، audit و تغییرات همگام‌سازی

### 11.1 Idempotency

- جدول `idempotency_records` یا طراحی معادل با scope مشخص (organization, actor/device, key, request hash, response status/body reference, timestamps)؛
- unique constraint واقعی؛
- کلید از هدر `Idempotency-Key` گرفته شود، UUID/random و length/format معتبر؛
- درخواست اول نتیجه و key را در هماهنگی تراکنشی با عملیات مربوط ثبت کند؛
- همان key + همان canonical request → همان logical result؛
- همان key + درخواست متفاوت → HTTP 409 با `IDEMPOTENCY_KEY_REUSED`؛
- رفتار در timeout نامعلوم و concurrent duplicates تست شود؛
- رکوردهای idempotency مالی را با پاک‌سازی زمان‌دار ساده حذف نکن؛ retention policy صریح باشد.

### 11.2 Audit trail

برای اعمال حساس ثبت کن:

- actor/user ID و organization ID؛
- action؛ entity type/ID؛
- زمان server-side؛ correlation ID؛
- دلیل reversal/adjustment در صورت لزوم؛
- before/after فقط برای فیلدهای مجاز و بدون رمز/توکن؛
- نتیجهٔ عملیات اگر برای audit لازم باشد.

کاربر عادی نباید بتواند audit event را ویرایش یا حذف کند. `AuditEvent` جای دفتر مالی/ledger را نمی‌گیرد.

### 11.3 مدل Sync مناسب اپ آفلاین‌اول

بک‌اند باید sync را پشتیبانی کند، ولی کد Flutter/Drift یا منطق UI موبایل را تولید نکند.

**Mutation queue:** کلاینت آفلاین عملیات را محلی ذخیره می‌کند و پس از اتصال همان REST mutationها را با idempotency key پایدار می‌فرستد. API اختصاصی که JSON دلخواه را به entity عمومی تبدیل کند ممنوع است.

**Pull changes:**

- `organization_sync_state` برای cursor/sequence سازمانی؛
- `sync_changes` شامل sequence، organization, entityType, entityId, action (`UPSERT`/`TOMBSTONE` یا معادل)، entityVersion، occurredAt؛
- رویداد تغییر با همان transaction نوشتن entity ثبت شود؛
- cursor باید برای paging از دست‌دادن تغییرها نداشته باشد؛ بررسی کن که sequence عادی PostgreSQL به‌تنهایی الزاماً ترتیب commit را تضمین نمی‌کند؛ راهکار sequence را در transaction و با concurrency روشن طراحی کن؛
- برای MVP با حجم کم می‌توان از row `organization_sync_state` و lock تراکنشی استفاده کرد تا sequence سازمانی در مرز transaction قابل اتکا باشد؛ اثر کارایی و deadlock را تحلیل و تست کن؛
- endpoint تغییرات ترتیب پایدار بر اساس sequence برگرداند؛ `nextCursor`, `hasMore`, `minAvailableCursor` و schema version روشن باشد؛
- اگر cursor قدیمی‌تر از retention باشد، پاسخ واضح `SYNC_RESYNC_REQUIRED` بده؛ نه اینکه تغییرها را بی‌صدا رد کنی؛
- tombstone برای archive/delete منطقی لازم است؛ کلاینت نمی‌تواند با حذف دادهٔ سرور آن را نامرئی فرض کند؛
- دادهٔ شخصی غیرضروری در change event نگهداری نشود. اگر snapshot برگردانده می‌شود، فقط DTO مجاز و tenant-scoped باشد؛
- entity version و `expectedVersion` برای تشخیص تعارض؛
- هرگز last-write-wins را برای payment، charge، deposit، bed assignment یا دیگر تغییرهای حیاتی استفاده نکن.

### 11.4 تعارض‌ها

- پرداخت جدید با idempotency identity شناخته می‌شود؛ retry نباید پرداخت تکراری بسازد.
- اگر دو دستگاه برای تخصیص یک بستر هم‌زمان درخواست ثبت دهند، تنها یک عملیات پذیرفته شود و دیگری conflict بگیرد.
- اگر client یک resident یا contract را بر اساس نسخهٔ قدیمی تغییر دهد، پاسخ conflict با وضعیت فعلی/نسخهٔ فعلی در حد مجاز برگردد.
- خطاهای retryable از conflict و validation جدا باشند.
- پاسخ sync per-operation باید وضعیت قابل فهم ماشینی داشته باشد: `APPLIED`, `DUPLICATE`, `CONFLICT`, `VALIDATION_FAILED`, `FORBIDDEN`, `RETRYABLE_FAILURE` (نام نهایی را قرارداد تثبیت کند).
- sync pull باید قابل restart باشد؛ کلاینت cursor را فقط پس از ذخیرهٔ اتمیک همهٔ صفحه در دیتابیس محلی SQLite/Drift پیش ببرد؛ این نکته در `docs/api/offline-sync.md` مستند شود.

### معیار عبور
دو دستگاه آزمایشی، retry، page boundary، duplicate request، تعارض نسخه، tombstone و cursor retention در تست‌ها پوشش داده شوند.

## فاز 12 — امنیت، validation و سخت‌سازی API

### الزامات

1. Input validation برای path/query/header/body؛ محدودیت اندازهٔ body؛ رد فیلدهای ناشناخته.
2. SQL injection از query parameterهای خام و dynamic sort جلوگیری شود؛ از ORM/parameter binding استفاده کن.
3. DTOها مجوز mass assignment ندهند؛ Prisma model مستقیماً به‌عنوان request body یا response برنگردد.
4. Object-level authorization روی همهٔ شناسه‌های دریافتی.
5. Function-level authorization روی عملیات حساس.
6. CORS فقط برای originهای مشخص؛ در production origin wildcard با credential ممنوع.
7. HTTPS در production؛ backend در حالت dev فقط تنظیم واضح dev داشته باشد.
8. password hashing با encoder معتبر؛ tokenها و secretها از log حذف شوند.
9. refresh token rotation، revoke و expiry تست شود.
10. login throttling/rate limit؛ محدودیت pagination، payload و عملیات پرهزینه.
11. مدیریت secret با environment/secret manager؛ `.env` واقعی در Git نباشد.
12. امنیت Swagger UI/OpenAPI endpoint؛ در production می‌تواند محدود یا غیرفعال شود.
13. فقط endpointهای health/diagnostics لازم expose شوند و اطلاعات داخلی افشا نشود.
14. response headers مناسب و error response بدون stack trace.
15. وابستگی‌ها scan/audit و نسخه‌ها pin شوند؛ آسیب‌پذیری شناخته‌شده و دلیل پذیرش هر ریسک ثبت شود.
16. `@Transactional` و lock strategy در عملیات حساس به‌طور واقعی تست شوند.
17. اطلاعات تماس ساکن فقط به نقش مجاز برگردد؛ minimization در DTO و logs.
18. API فایل آپلودی در MVP نساز مگر در scope باشد؛ اگر بعداً اضافه شد MIME/content/size/path validation لازم است.

### معیار عبور
چک‌لیست threat model و OWASP API Security Top 10 متناسب با MVP بررسی شود؛ یافته‌ها Pass/Fail/Not Applicable همراه دلیل و شاهد داشته باشند. ادعای گواهی رسمی امنیتی نکن.

## فاز 13 — آزمون‌های کامل و کیفیت

### لایه‌های آزمون الزامی

1. Unit tests: منطق دامنه و محاسبات.
2. Integration tests: PostgreSQL واقعی از طریق Testcontainers، constraints، migrations و transaction rollback.
3. API/controller tests: validation، status code، auth و Problem Details.
4. OpenAPI contract tests: request/response runtime با قرارداد مطابقت داشته باشد.
5. Security tests: tenant isolation، BOLA/IDOR، role checks، refresh token misuse، mass assignment.
6. concurrency tests: duplicate payment, bed assignment race, allocation race, version conflict.
7. migration tests: empty DB -> latest و supported version -> latest.
8. regression tests: برای هر bug جدی یک test reproduction.
9. end-to-end integration suite برای جریان کامل کسب‌وکار.
10. reconciliation tests: محاسبه مستقل بدهی/ودایع/مصارف و تطبیق با API.
11. sync tests: cursor monotonicity, pagination, stale cursor, tombstone, conflict and retry.
12. configuration tests: missing secret/config و fail-fast behavior.

### E2E سناریوی نمونه

1. مالک ثبت شود و سازمان ساخته شود.
2. لیلیه، اتاق و دو بستر ساخته شود.
3. دو ساکن و قرارداد ساخته شوند.
4. به هر ساکن بستر تخصیص داده شود.
5. تلاش تخصیص هم‌زمان همان بستر به ساکن دیگر رد شود.
6. برای ساکن A صورتحساب 10,000.00 AFN ساخته شود.
7. دریافت‌های 4,000.00 و 3,000.00 AFN ثبت شوند؛ مانده 3,000.00 AFN باشد.
8. ودیعهٔ 5,000.00 AFN ثبت و در گزارش کرایه از هم جدا نشان داده شود.
9. یک هزینه ثبت شود و گزارش مالی روزانه تطبیق شود.
10. همان payment request تکرار شود؛ پرداخت تازه نسازد.
11. payment reversal تست شود؛ trace اصلی باقی بماند.
12. درخواست سازمان دیگر به resident/charge این سازمان دسترسی نداشته باشد.
13. sync cursor تغییرها را صفحه‌به‌صفحه بدون skip برگرداند.
14. نسخهٔ قدیمی entity تعارض دهد و آخرین داده را بی‌صدا overwrite نکند.
15. migration روی PostgreSQL تازه و upgrade اجرا شود.

### Quality gates

برای هر فاز باید دست‌کم موارد مرتبط اجرا شود:

- npm build؛
- unit/integration tests؛
- lint/format check؛
- OpenAPI lint/validation؛
- migration verification؛
- بررسی diff و فایل‌های تغییرکرده؛
- گزارش نتیجه با command واقعی.

Coverage درصدی به‌تنهایی معیار کیفیت نیست. invariantها و سناریوهای مرزی منطق مالی و sync از coverage خام مهم‌ترند. درصد هدف را بی‌منبع به‌عنوان استاندارد رسمی معرفی نکن.

### معیار عبور
تست‌های MVP پاس؛ هیچ نقص باز Critical/High شناخته‌شده بدون تصمیم مالک وجود نداشته باشد؛ تمام محدودیت‌ها آشکار و مستند باشند.

## فاز 14 — پیکربندی عملیاتی، backup/restore و مشاهده‌پذیری

### Config profiles

- `local`: اجرای آسان توسعه و دادهٔ ساختگی؛
- `test`: PostgreSQL/Testcontainers و secretهای آزمایشی؛
- `prod`: secretهای اجباری، HTTPS/proxy assumptions روشن، اجرای migration با `prisma migrate deploy`، ممنوعیت `prisma db push` در production، log redaction و بدون sample credentials.

### Backup/restore دیتابیس مرکزی

- پشتیبان‌گیری PostgreSQL باید به‌عنوان روش عملیاتی مستند شود؛ از `pg_dump`/`pg_restore` یا سرویس مدیریت‌شدهٔ دیتابیس مطابق محیط استفاده کن.
- backup را داخل endpoint عمومی اپ نساز؛ عملیات recovery باید محدود به مدیر سیستم/DevOps باشد.
- مسیر backup، رمزگذاری در حالت سکون، retention، دسترسی، RPO/RTO پیشنهادی و روش restore مستند باشد.
- حداقل یک restore rehearsal در محیط جدا اجرا کن؛ وجود فایل backup به‌تنهایی اثبات قابلیت بازیابی نیست.
- backup شامل secretهای runtime یا refresh tokenهای plaintext نباشد.
- هنگام restore نسخهٔ schema و compatibility بررسی شود.

### Logging و metrics

- correlation ID برای هر request؛
- latency/status code/error code و شمار درخواست‌ها، بدون ثبت PII یا payload مالی؛
- health/readiness؛
- log سطح مناسب و retention؛
- اگر OpenTelemetry/metrics اضافه می‌شود، نیاز و هزینه‌اش را ثبت کن؛ برای MVP observability ساده و امن کافی است.

### معیار عبور
اجرای local documented؛ configuration ناقص در production fail-fast؛ backup و restore عملیاتی دست‌کم یک‌بار آزموده و نتیجه ثبت شده باشد.

## فاز 15 — مستندات کامل و آماده‌سازی تحویل بک‌اند

### مستندات الزامی

- `README.md` با معرفی دقیق ESKAN، محدوده و وضعیت واقعی؛
- `docs/development/setup.md`؛
- `docs/development/testing.md`؛
- `docs/domain/requirements.md`؛
- `docs/domain/open-questions.md`؛
- `docs/architecture/architecture-overview.md` و ADRها؛
- `docs/database/schema-overview.md` و data dictionary؛
- `contracts/openapi.yaml`؛
- `docs/api/api-conventions.md`؛
- `docs/api/error-model.md`؛
- `docs/api/permissions-matrix.md`؛
- `docs/api/idempotency.md`؛
- `docs/api/offline-sync.md`؛
- `docs/product/subscription-and-entitlements.md`؛
- `docs/security/platform-admin.md`؛
- `docs/operations/manual-subscription-activation.md`؛
- `docs/security/authentication.md`؛
- `docs/security/authorization.md`؛
- `docs/security/threat-model.md`؛
- `docs/operations/backup-restore.md`؛
- `docs/operations/deployment.md`؛
- `docs/project/risks-register.md`؛
- `docs/project/progress.md`؛
- `CHANGELOG.md` یا release notes.

### پذیرش Backend Release Candidate

فقط در صورتی وضعیت RC اعلام شود که:

- تمام MUSTهای MVP پیاده و مستند شده باشند؛
- OpenAPI معتبر و همسو با runtime باشد؛
- clean build در محیط مورد نظر موفق باشد؛
- unit/integration/contract/security/E2E و migration tests مرتبط اجرا شوند؛
- تست‌های مالی، idempotency، tenant isolation، assignment concurrency، sync cursor، trial expiry، plan limits و Platform Admin subscription activation پاس شوند؛
- دیتابیس fresh و upgrade پشتیبانی‌شده موفق باشد؛
- backup/restore آزمایش عملی داشته باشد؛
- هیچ secret واقعی در repository یا logs وجود نداشته باشد؛
- هیچ نقص Critical/High شناخته‌شده بدون پذیرش ریسک باقی نمانده باشد؛
- تمام محدودیت‌ها و سؤال‌های باز گزارش شده باشند.

## فاز 16 — گزارش نهایی و تحویل برای فرانت‌اند

در انتها گزارش زیر را واقعی و کوتاه اما کامل ارائه کن:

1. وضعیت: `PASS`, `CONDITIONAL PASS` یا `FAIL`؛
2. فازهای تکمیل‌شده و باقیمانده؛
3. معماری قطعی و دلایل؛
4. نسخه‌های واقعی Node.js/npm/NestJS/TypeScript/Prisma/PostgreSQL و ابزارها؛
5. محل قرارداد OpenAPI، نسخه و تعداد endpointهای عملیاتی؛
6. دستورهای واقعی build/test/lint/OpenAPI/migration و خروجی آن‌ها؛
7. تعداد تست‌ها، تعداد پاس/فیل/skip و محدودیت‌ها؛
8. جدول وضعیت acceptance criteria؛
9. مدل دیتابیس و migrationهای اعمال‌شده؛
10. روش اجرا در local و production؛
11. آدرس‌های API/Swagger در محیط توسعه، بدون secret؛
12. ریسک‌ها، سؤال‌های باز و known limitations؛
13. مواردی که برای شروع فرانت‌اند اندروید آماده‌اند؛
14. وضعیت trial، طرح‌ها، محدودیت‌ها، اشتراک‌های فعال/منقضی و APIهای فعال‌سازی دستی؛
15. تأکید که Flutter/Dart و SQLite/Drift موبایل و UI پنل وب در این مخزن بک‌اند پیاده نشده‌اند؛ APIهای بک‌اند برای پنل آینده موجود باشند.

به هیچ وجه تست یا build اجرا‌نشده را موفق اعلام نکن؛ اگر محیط مانع است، دقیقاً نام فرمان و خطا را گزارش بده.

---

# بخش C — راهنمای دقیق مدل دامنه و قواعد مالی

## 1. مرزبندی Tenant

- `Organization` مرز مالکیت داده‌ها است.
- کاربر می‌تواند یک یا چند `OrganizationMembership` داشته باشد.
- تمام داده‌های مالی، ساکنان، لیلیه‌ها، اتاق‌ها، بسترها، قراردادها و درخواست‌های sync به یک organization مشخص تعلق دارند.
- برای هر درخواست tenant-scoped، سازمان فعال از security context و membership معتبر به‌دست بیاید.
- از قبول `organizationId` دلخواه در body به‌عنوان authority خودداری کن.
- هر query باید tenant-scoped باشد؛ repositoryهای حساس باید این الگو را واضح و تست‌پذیر کنند.
- شناسهٔ تصادفی UUID جایگزین authorization نیست.
- در صورت استفاده از `X-Organization-Id`, این header تنها سازمان مورد نظر را مشخص می‌کند؛ سرور باید وجود membership فعال و role مناسب را بررسی کند.

## 2. وضعیت‌ها و lifecycle

برای هر entity دارای وضعیت، transitionهای مجاز را در یک جدول مستند کن. نمونه:

- Contract: draft -> active -> terminated/closed؛ transitionهای برگشتی بدون قاعده ممنوع.
- Charge: draft اگر وجود دارد -> posted -> reversed؛ charge posted نباید ویرایش آزاد شود.
- Payment: posted -> reversed؛ پرداخت reversed همچنان در تاریخچه وجود دارد.
- Expense: posted -> reversed.
- Resident: active/inactive/archived؛ archive مانع دیدن تاریخچه نمی‌شود.
- Maintenance request در صورت شمول MVP: open -> in_progress -> resolved/cancelled.

از یک enum بدون کنترل transition استفاده نکن؛ use-case باید transition را enforce کند.

## 3. پول و گزارش‌ها

- TypeScript: Decimal object از `decimal.js`; برای محاسبه scale و rounding مشخص باشد؛ rounding خاموش در هر setter ممنوع.
- PostgreSQL: `NUMERIC(19,2)` یا precision دیگری که در ADR توجیه شده باشد.
- API: amount به‌شکل string ده‌دهی همراه `currency`.
- currency پیش‌فرض `AFN`; چندارزی در MVP غیرفعال مگر requirement مشخص.
- منفی‌سازی مبلغ برای reversal ممنوع؛ reversal یک رویداد مستقل با رابطه به سند اصلی است.
- مجموع allocationهای active به charge/payment نباید از مبلغ معتبر مربوط بیشتر شود.
- Charge = تعهد/صورتحساب؛ Payment = وجه دریافت‌شده؛ Deposit = تعهد/وجه تضمین‌شده و مستقل؛ Expense = هزینهٔ ثبت‌شده/پرداخت‌شده در MVP.
- «کل دریافتی» را با «کل charge» یکی نکن.
- ماندهٔ resident را از Chargeها، allocationها و reversalها محاسبه کن؛ در صورت cache، روش بازسازی و reconciliation لازم است.
- با تغییر نرخ قرارداد در آینده، سوابق قدیمی ثابت بمانند.
- payment/charge/expense posted را hard delete نکن.

## 4. تاریخ و زمان

- timestamp ثبت سمت سرور در UTC ذخیره شود.
- تاریخ‌های کاری/دورهٔ کرایه با `LocalDate` ثبت شوند.
- timezone پیش‌فرض ارائهٔ گزارش و تنظیمات سازمان `Asia/Kabul`، اما timezone کاربر را با تاریخ کاری سند یکی نکن.
- timestamp ارسال‌شده از کلاینت فقط metadata غیرقابل اعتماد است؛ زمان قطعی ثبت از سرور تعیین می‌شود.
- هرگونه backdate باید مجاز، دارای business date، actor و audit trail باشد.
- اگر تقویم شمسی در UI آینده نمایش داده می‌شود، API نباید تاریخ را به متن محلی وابسته کند؛ قرارداد تاریخ استاندارد ISO بماند.

## 5. شماره سند و رسید

- UUID شناسهٔ فنی است؛ شماره رسید قابل‌خواندن شناسهٔ کسب‌وکار جداگانه است.
- یکتایی شماره در محدودهٔ سازمان و نوع سند تعریف شود.
- شماره‌گذاری در transaction/constraint امن باشد؛ درخواست‌های concurrent یا retry نباید collision بسازند.
- شماره سند قطعی نباید پس از صدور بازنویسی شود.
- هیچ requirement قانونی/مالیاتی افغانستان را حدس نزن؛ شماره‌گذاری فعلی ابزار داخلی است، مگر مشاور محلی خلاف آن را تأیید کند.

---

# بخش D — قراردادهای داده و API که فرانت‌اند آینده به آن تکیه می‌کند

## 1. Common fields

برای entityهای قابل نمایش، حسب نیاز:

- `id: UUID string`
- `version: integer`
- `createdAt: RFC3339 timestamp`
- `updatedAt: RFC3339 timestamp`
- `status: enum string`

برای tenant-owned records، `organizationId` را در response در صورت نیاز برای sync/debug برگردان؛ هرگز این فیلد را برای مجوز سرور از client قبول نکن.

## 2. Pagination

یک الگوی pagination را برای کل API انتخاب کن. برای نسخهٔ اول offset/page قابل قبول است، اما برای sync از cursor مستقل استفاده کن. تعریف کن:

- `page`/`size` یا `limit`؛
- default و max size؛
- sorting مجاز؛
- `items`, `page`, `size`, `totalElements`, `totalPages` یا ساختار توافق‌شده؛
- هیچ ورودی sort خام مستقیم به DB پاس داده نشود.

## 3. Idempotency response

در پاسخ replay، همان resource/result مربوط به عملیات اولیه یا نتیجهٔ معادل طبق قرارداد برگردد. response مبهم که کلاینت را مجبور به retry کور کند نده. در صورت timeout پس از commit، client باید با همان idempotency key بتواند نتیجه را دوباره بازیابی کند.

## 4. Error catalogue پیشنهادی

کدهای خطای پایدار می‌توانند شامل موارد زیر باشند؛ هر کد را تنها جایی استفاده کن که معنای آن دقیقاً تطبیق دارد:

- `VALIDATION_ERROR`
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `RESOURCE_NOT_FOUND`
- `RESOURCE_VERSION_CONFLICT`
- `IDEMPOTENCY_KEY_REUSED`
- `DUPLICATE_RECEIPT_NUMBER`
- `BED_ASSIGNMENT_OVERLAP`
- `CONTRACT_NOT_ACTIVE`
- `CHARGE_ALREADY_REVERSED`
- `PAYMENT_ALREADY_REVERSED`
- `ALLOCATION_EXCEEDS_PAYMENT`
- `DEPOSIT_BALANCE_INSUFFICIENT`
- `SYNC_RESYNC_REQUIRED`
- `SYNC_CURSOR_INVALID`
- `BUSINESS_RULE_VIOLATION`
- `RATE_LIMITED`

Status codeها:

- `400` برای request نامعتبر عمومی،
- `401` برای نبود/نامعتبر بودن authentication،
- `403` برای کاربر authenticated بدون permission،
- `404` برای resource موجود نبودن یا وقتی عدم افشای وجود resource لازم است،
- `409` برای تعارض نسخه/وضعیت/idempotency/assignment،
- `422` اگر این semantics در قرارداد انتخاب شده باشد و به‌صورت یکدست به کار رود،
- `429` برای rate limiting،
- `500` فقط برای خطای غیرمنتظره با trace ID و بدون جزئیات داخلی.

قالب و semantics را یک‌بار تعیین کن و برای تمام endpointها یکسان پیاده کن.

---

# بخش E — ساختار پوشهٔ پیشنهادی

ساختار نهایی را با نیاز واقعی NestJS سازگار کن؛ این نمونه جهت‌دهنده است، نه دستور ساخت کورکورانه:

```text
eskan-backend/
├── package.json
├── package-lock.json
├── tsconfig.json
├── nest-cli.json
├── eslint.config.mjs
├── .prettierrc
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── README.md
├── contracts/
│   └── openapi.yaml
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── docs/
│   ├── project/
│   ├── product/
│   ├── domain/
│   ├── architecture/decisions/
│   ├── database/
│   ├── api/
│   ├── security/
│   ├── development/
│   └── operations/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── config/
│   │   ├── errors/
│   │   ├── filters/
│   │   ├── interceptors/
│   │   ├── logging/
│   │   ├── security/
│   │   ├── validation/
│   │   └── tenancy/
│   ├── database/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── auth/
│   ├── organizations/
│   ├── hostels/
│   ├── rooms/
│   ├── beds/
│   ├── residents/
│   ├── stay-contracts/
│   ├── assignments/
│   ├── charges/
│   ├── payments/
│   ├── deposits/
│   ├── expenses/
│   ├── reports/
│   ├── audit/
│   └── sync/
├── test/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   ├── security/
│   ├── concurrency/
│   └── e2e/
└── scripts/
    ├── validate-openapi.*
    └── verify-local.*
```

در هر feature از فایل‌های کوچک و مسئولیت‌محور استفاده کن. Prisma model را مستقیماً به DTO عمومی تبدیل نکن. ورودی‌ها و خروجی‌های API باید DTOهای مشخص داشته باشند؛ فیلدهای داخلی و حساس هرگز ناخواسته serialize نشوند. اگر package یا مسیر متفاوتی مناسب‌تر است، تصمیم را در ADR ثبت کن.

---

# بخش F — پروتکل کار با ایجنت و گزارش هر فاز

پس از هر فاز، دقیقاً این گزارش را در پاسخ و در `docs/project/progress.md` ارائه کن:

1. فاز و هدف؛
2. فایل‌های ایجادشده/تغییریافته؛
3. تصمیمات مهم و دلیل؛
4. فرمان‌هایی که واقعاً اجرا شده‌اند؛
5. نتیجهٔ واقعی build/test/lint/migration/contract check؛
6. معیارهای پذیرش به‌صورت `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`؛
7. خطاها و ریسک‌های باز؛
8. فرضیات یا پرسش‌هایی که به مالک محصول وابسته‌اند؛
9. next actions مشخص.

**رفتار اجرایی:**

- در آغاز فقط repository assessment انجام بده.
- سپس تحلیل و OpenAPI را بساز.
- پس از تثبیت domain model و قرارداد، implementation را ادامه بده؛ فقط سند ننویس.
- بعد از هر ماژول build و تست مربوط را اجرا و خطاها را اصلاح کن.
- اگر تست fail شد، علت را پیدا کن و رفع کن؛ تست را صرفاً برای سبزشدن حذف یا skip نکن.
- هیچ assertion مهمی را به‌دلیل دشواربودن حذف نکن.
- از test double برای منطق ساده بهره ببر، اما قیدهای PostgreSQL، transaction، locking، migration و concurrency باید روی PostgreSQL واقعی آزمایش شوند.
- برای queryهایی که از ورودی می‌آیند از parameter binding و allow-list استفاده کن.
- وابستگی جدید تنها با دلیل، compatibility evidence و نسخهٔ pin شده اضافه شود.
- هیچ دادهٔ واقعی/شخصی را در fixture، screenshot، log، README یا commit وارد نکن.
- فرانت‌اند را به‌صورت خودکار شروع نکن. پایان کار، بک‌اند و قرارداد قابل مصرف برای فرانت‌اند باشد.

---

# بخش G — تعریف Done برای ESKAN Backend

یک قابلیت Done محسوب می‌شود، فقط اگر:

- نیازمندی و رفتار آن مستند باشد؛
- قرارداد endpoint و schema مشخص داشته باشد؛
- validation ورودی و mapping خطا درست باشد؛
- use-case با tenant context و permission معتبر کار کند؛
- رفتار transaction/rollback مشخص باشد؛
- audit و sync change در موارد لازم ثبت شوند؛
- idempotency و optimistic concurrency در mutationهای لازم رعایت شود؛
- unit test و integration test مرتبط وجود داشته باشد؛
- OpenAPI معتبر بماند؛
- migration لازم وجود داشته و روی PostgreSQL اجرا شده باشد؛
- هیچ TODO یا placeholder پنهان به‌جای منطق اصلی وجود نداشته باشد؛
- اجرای واقعی و نتیجه ثبت شده باشد.

# بخش H — منابع رسمی برای اعتبارسنجی فنی

این فهرست نقطهٔ شروع است؛ نسخه‌ها و compatibility را هنگام اجرای پروژه دوباره بررسی کن:

- NestJS documentation: https://docs.nestjs.com/
- Node.js releases: https://nodejs.org/en/about/previous-releases
- TypeScript documentation: https://www.typescriptlang.org/docs/
- Prisma ORM: https://www.prisma.io/docs/orm
- Prisma Migrate: https://www.prisma.io/docs/orm/prisma-migrate
- NestJS OpenAPI: https://docs.nestjs.com/openapi/introduction
- OpenAPI Specification: https://spec.openapis.org/oas/
- RFC 9457 Problem Details: https://www.rfc-editor.org/rfc/rfc9457
- PostgreSQL documentation: https://www.postgresql.org/docs/
- OWASP API Security Top 10: https://owasp.org/www-project-api-security/
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Flutter persistence guidance for the future client: https://docs.flutter.dev/app-architecture/design-patterns/offline-first


# بخش ویژهٔ الزام‌آور — چرخهٔ اشتراک، Trial و فعال‌سازی دستی (نسخهٔ 3.0)

این بخش تکمیل‌کنندهٔ scope MVP است و هر جملهٔ قدیمی که اشتراک یا API مدیریتی آن را خارج از دامنه دانسته، با این بخش اصلاح می‌شود. «پرداخت آنلاین» و «پنل وب» همچنان خارج از scope هستند؛ «مدیریت اشتراک در بک‌اند» داخل scope است.

## 1. تصمیم محصول و تجربهٔ پیشنهادی

مدل اولیه باید برای کاهش مانع ورود، یک دورهٔ آزمایشی کامل و سپس یک طرح رایگان محدود داشته باشد؛ بعداً مالک محصول می‌تواند قیمت و محدودیت‌ها را بدون بازنویسی منطق دامنه تنظیم کند.

- به‌محض ایجاد سازمان و عضویت OWNER، یک Trial با مدت پیش‌فرض ۳۰ روز تقویمی به سازمان داده شود؛ مدت باید قابل تنظیم باشد. زمان شروع و پایان توسط سرور تعیین گردد.
- Trial ویژگی‌های طرح `PRO` را برای مدت trial فعال می‌کند. از trial خودکار دوم برای همان سازمان جلوگیری شود. هر استثنا فقط با اقدام مجاز Platform Admin و همراه دلیل audit شود. سامانه نباید ادعا کند می‌تواند افراد را بدون هویت تأییدشده در تمام حساب‌ها deduplicate کند؛ محدودیت‌های ضدسوءاستفاده باید صریح و قابل پیکربندی باشد.
- وقتی Trial تمام می‌شود، سازمان به طرح `FREE` برگردد؛ داده‌ها حذف، پنهان یا خراب نشوند. از قفل‌کردن کامل حساب یا گروگان‌گرفتن سوابق مالی خودداری شود.
- طرح FREE برای ادامهٔ استفادهٔ پایه باقی بماند. مقادیر اولیهٔ محدودیت‌ها باید configurable باشند، نه hard-coded در service یا اپ. به‌عنوان seed قابل تغییر می‌توان یک لیلیه، تعداد محدود ساکن فعال، یک عضو عملیاتی و گزارش‌های پایه در نظر گرفت؛ قیمت‌های پولی را جعل یا نهایی فرض نکن. اگر قیمت هنوز از مالک دریافت نشده، آن را به‌عنوان تصمیم باز ثبت کن و از درج قیمت تجاری ساختگی خودداری کن.
- طرح‌های `PRO` و `BUSINESS` می‌توانند قابلیت‌ها و سقف‌های بیشتری مانند چند لیلیه، تعداد بیشتر ساکنان/اعضا/دستگاه‌ها، خروجی‌های پیشرفته یا گزارش‌های تخصصی فراهم کنند. دقیق‌ترین قیمت‌ها و limitها باید دادهٔ قابل تنظیم plan باشند و در `docs/product/subscription-and-entitlements.md` ثبت شوند.
- پس از انقضای اشتراک پولی، grace period قابل‌تنظیم داشته باش؛ مقدار اولیهٔ پیشنهادی ۷ روز است. پس از آن، طرح مؤثر سازمان به FREE تنزل یابد. هر تمدید یا تعلیق دستی تاریخ و دلیل audit داشته باشد.
- اگر سازمان بیش از محدودیت طرح رایگان دادهٔ موجود دارد، آن داده را پاک یا مخفی نکن. ایجاد رکورد جدیدی که از سقف طرح عبور می‌کند ممکن است با خطای دامنه‌ای `PLAN_LIMIT_EXCEEDED` رد شود؛ خواندن، مشاهدهٔ تاریخچه، export/backup داده و گردش‌های حیاتی مالی مربوط به ساکنان موجود صرفاً به علت پایان Trial/اشتراک مسدود نشوند. به‌ویژه، sync operationهای مالی معتبرِ ساکنان موجود را به‌خاطر این‌که در زمان آفلاین دوره منقضی شده است، خاموش یا بی‌توضیح رد نکن. entitlement policy مربوط به queued offline writes را مستند و تست کن.
- هیچ‌گاه Trial را با تاریخ/ساعت ارسالی از موبایل محاسبه نکن؛ زمان سرور مرجع است. تاریخ‌ها در دیتابیس به‌صورت UTC/TIMESTAMPTZ ذخیره و در خروجی ISO-8601 ارائه شوند.

## 2. وضعیت‌ها و مدل داده

مدل حداقلی را با Prisma طراحی کن؛ نام‌ها ممکن است با ADR تغییر کنند، اما تمام قابلیت‌ها باید پوشش داده شوند:

- `SubscriptionPlan`: کد یکتا (`FREE`, `PRO`, `BUSINESS`)، نام/توضیح، وضعیت انتشار/فعال‌بودن، ارز `AFN` برای نسخهٔ اول، قیمت و دورهٔ صورتحساب در صورت تعیین‌شدن، limits و features اعتبارسنجی‌شده، timestamps و version. پلان دارای سابقه نباید hard-delete شود.
- `OrganizationSubscription`: `organizationId`، `planId`، وضعیت (`TRIALING`, `ACTIVE`, `GRACE_PERIOD`, `FREE`, `EXPIRED`, `SUSPENDED` بر اساس مدل نهایی)، trial start/end، paid period start/end، grace end، زمان ایجاد/تغییر، version و actor مربوط. فقط یک entitlement جاری مؤثر برای هر سازمان وجود داشته باشد؛ تاریخچه جدا نگهداری شود.
- `SubscriptionEvent` یا `SubscriptionAuditEvent`: رویدادهای append-only شامل trial شروع‌شده، trial پایان‌یافته، طرح فعال/تمدید/تغییر/تعلیق/ازسرگیری/تنزل‌یافته؛ `organizationId`, `actorPlatformAdminId` یا system actor، timestamp، دلیل، مقادیر قبل/بعد و traceId. رویداد قبلی پاک یا بازنویسی نشود.
- `ManualSubscriptionPayment`: سابقهٔ دریافت وجه بابت اشتراک خود ESKAN، نه وجه دریافتی از ساکنان لیلیه. شامل organization، subscription/period، amount+currency، method (`CASH`, `BANK_TRANSFER`, `MOBILE_MONEY`, `OTHER`)، reference اختیاری، تاریخ دریافت/تأیید، `verifiedByPlatformAdminId`، یادداشت و audit. هیچ رمز، PIN، OTP، شمارهٔ کامل کارت یا credential پرداخت ذخیره نشود. وضعیت activation صرفاً با مقدار ارسالی client یا reference تأییدنشده فعال نشود؛ تأیید دستی توسط Platform Admin مجاز لازم است.
- `Platform Admin` هویت/مجوز سطح سیستم است و با `OWNER` یا `ADMIN` سازمان یکی نیست. ایجاد اولین Platform Admin از مسیر bootstrap امن/CLI یا seed امن با دستورالعمل است؛ endpoint عمومی برای ارتقای خود به Platform Admin ممنوع. secrets حساب مدیریتی default در repo نباشد.

ذخیرهٔ limits/features می‌تواند با schema رابطه‌ای یا JSONB نوع‌دار انجام شود؛ اگر JSONB انتخاب شد، shape آن در TypeScript به‌شکل strict تعریف و در runtime اعتبارسنجی شود. دادهٔ دلخواه و اعتبارسنجی‌نشده را مستقیماً به‌عنوان entitlement مصرف نکن.

## 3. APIهای لازم در قرارداد OpenAPI و NestJS

APIهای زیر حداقل scope هستند؛ مسیر دقیق باید در قرارداد تثبیت شود و سپس DTO/controller/service/test با آن هم‌خوان باشند:

**API سازمان/کاربر عادی:**

- `GET /api/v1/plans`: فهرست طرح‌های فعال/قابل نمایش و ویژگی/حدود آن‌ها؛ قیمت نامشخص را به‌عنوان قیمت قطعی جعل نکن.
- `GET /api/v1/subscription/current`: طرح مؤثر، وضعیت، شروع/پایان Trial یا paid period، grace end، زمان باقی‌ماندهٔ محاسبه‌شده با زمان سرور، usage/limits و entitlements لازم برای UI.
- `GET /api/v1/subscription/history`: تاریخچهٔ مجاز و tenant-scoped وضعیت‌ها/فعال‌سازی‌های سازمان جاری. اطلاعات داخلی/محرمانهٔ Platform Admin را برنگردان.

این APIها برای نمایش وضعیت و محدودیت‌ها هستند؛ خرید/پرداخت داخل اپ یا درخواست پرداخت از درون اپ نمی‌سازند.

**APIهای Platform Admin برای پنل آینده:**

- فهرست/جست‌وجوی سازمان‌ها با صفحه‌بندی و حداقل دادهٔ شخصی؛
- مشاهدهٔ subscription و تاریخچهٔ سازمان؛
- فعال‌سازی طرح پولی پس از بررسی دستی پرداخت؛
- تمدید دوره، تغییر طرح، اعطای مهلت، تعلیق/ازسرگیری و اصلاح با دلیل؛
- ثبت اطلاعات لازم برای تأیید پرداخت دستی و اتصال آن به دورهٔ اشتراک؛
- مدیریت/انتشار/غیرفعال‌سازی طرح‌ها و limits/features در صورت تأیید scope؛ اگر مدیریت مستقیم طرح در MVP ساخته نشود، seed/CLI امن و مستند فراهم شود.

تمام endpointهای Platform Admin باید مجوز سطح سیستم را enforce کنند؛ صرفاً داشتن `OWNER` یا `ADMIN` در یک سازمان کافی نیست. مسیرها باید در OpenAPI با role/security واضح مستند شوند. هر mutation باید idempotency یا کنترل تکرار مناسب، audit event و آزمون مجوز داشته باشد.

## 4. فعال‌سازی دستی اشتراک پس از تماس/پرداخت بیرونی

سناریوی عملیاتی مورد انتظار:

1. مدیر لیلیه در اپ حساب می‌سازد و سازمانش Trial می‌گیرد.
2. در اپ وضعیت Trial، تاریخ پایان و محدودیت‌های طرح نمایش داده می‌شود.
3. برای خرید بیرون از اپ، مشتری از کانال‌های خارج از اپ با فروش/پشتیبانی ESKAN ارتباط می‌گیرد و روش پرداخت را طبق فرایند تجاری شرکت دریافت می‌کند.
4. اپراتور داخلی وجه را خارج از اپ بررسی می‌کند؛ پرداخت هنوز فقط وقتی تأییدشده است که اپراتور/Platform Admin مجاز آن را واقعاً بررسی کرده باشد.
5. از پنل وب آینده یا ابزار مدیریتی امنِ backend API، Platform Admin سازمان را پیدا می‌کند، طرح و مدت را تعیین، مشخصات حداقلی پرداخت را ثبت و فعال‌سازی را تأیید می‌کند.
6. بک‌اند در transaction واحد رکورد تأیید پرداخت (در صورت وجود)، به‌روزرسانی entitlement جاری، و SubscriptionAuditEvent را ثبت می‌کند. اگر هر بخش شکست بخورد، هیچ فعال‌سازی نیمه‌کاره باقی نماند.
7. موبایل در sync بعدی وضعیت جدید را از `GET /subscription/current` می‌گیرد؛ UI را خودش منبع حقیقت قرار نمی‌دهد.

برای تمدید پیش از پایان دوره، قاعدهٔ `startsAt = max(now, currentPeriodEnd)` یا رفتار هم‌ارز صریح، با timezone/UTC ثابت، انتخاب و تست شود تا روزهای باقی‌مانده از بین نروند. فعال‌سازی تکراری با همان idempotency identity نباید دوره یا مبلغ را دو بار ثبت کند.

## 5. مرزبندی Google Play و درگاه پرداخت

- در این MVP هیچ checkout، Google Play Billing SDK، bank API، Mobile Money API، external-payment button، direct payment URL، QR پرداخت یا مسیر پرداخت جایگزین داخل اپ موبایل یا API عمومی قرار نده.
- اپ باید به کاربری که در بیرون از اپ اشتراک خریده است اجازهٔ ورود و مصرف سرویس بر اساس entitlements بدهد؛ یعنی flow درون اپ consumption-only بماند.
- درون اپ می‌توان وضعیت طرح، پایان trial و توضیح غیرتراکنشی دربارهٔ محدودیت‌ها را نمایش داد. هیچ دکمه/لینک مستقیم به روش خرید بیرونی، پیام‌رسان پرداخت یا فرم پرداخت نساز. اگر متن «برای اطلاعات طرح‌ها با پشتیبانی تماس بگیرید» نمایش داده می‌شود، آن را از لینک یا دکمهٔ خرید جدا نگه دار و پیش از release با سیاست جاری Google Play بازبینی کن. ارتباط فروش و اطلاعات پرداخت می‌تواند از کانال‌های خارج از اپ انجام شود.
- این معماری تضمین پذیرش Google Play نیست؛ مسئول انتشار باید سیاست به‌روز Google Play را در زمان انتشار بازبینی کند. این سند جایگزین بررسی حقوقی یا policy review نیست.

## 6. Enforcement، امنیت و رفتار هنگام پایان دوره

- server-side guard/use-case برای feature entitlement و limits بساز؛ UI تنها برای تجربهٔ کاربری می‌تواند قابلیت ناموجود را مخفی/توضیح دهد.
- همهٔ APIهای حساس `organizationId` را از membership/security context معتبر بگیرند؛ Platform Admin endpointها از مجوز global جداگانه استفاده کنند.
- در پایان Trial یا اشتراک، entitlement مؤثر به Free/grace policy برود؛ دادهٔ مشتری حذف نشود و سوابق مالی غیرقابل‌حذف بمانند.
- خطاهای سقف طرح از Problem Details با code ثابت مثل `PLAN_LIMIT_EXCEEDED` برگردند؛ شامل feature/limit/usage باشد، اما اطلاعات داخلی امنیتی را افشا نکند.
- plan/entitlement cache اگر وجود دارد، versioned باشد و با activation/expiry/suspension بی‌درنگ یا در SLA مستند invalidation شود.
- تاریخچهٔ Trial، تمدید، activation، downgrade، suspension و manual payment append-only و قابل audit باشد. Platform Admin نتواند تاریخچه را پاک یا بازنویسی کند؛ correction با رویداد اصلاحی انجام شود.
- اشتراک نرم‌افزار باید از accounting عملیاتی سازمان‌ها جدا باشد. درآمد اشتراک ESKAN در گزارش دریافتی کرایهٔ لیلیه‌های مشتری ظاهر نشود؛ Payment مربوط به resident هرگز به‌عنوان subscription payment استفاده نشود.

## 7. تست‌های اجباری و معیار پذیرش اشتراک

حداقل این سناریوها را بنویس و واقعاً اجرا کن:

1. ثبت سازمان فقط یک Trial واجد شرایط ایجاد می‌کند؛ درخواست تکراری، retry یا دوباره‌اجراکردن signup Trial دوم نمی‌سازد.
2. قبل از پایان Trial entitlements درست هستند؛ بعد از پایان بر مبنای زمان سرور به Free/grace policy منتقل می‌شود.
3. با تغییر ساعت دستگاه، کاربر نمی‌تواند Trial را تمدید کند.
4. کاربر سازمان A نمی‌تواند subscription/usage/history سازمان B را بخواند یا تغییر دهد.
5. OWNER/ADMIN سازمان نمی‌تواند APIهای Platform Admin را صدا بزند؛ Platform Admin غیرمجاز نیز رد می‌شود.
6. فعال‌سازی/تمدید دستی در transaction واحد ثبت می‌شود؛ شکست میان عملیات، وضعیت نیمه‌کاره نمی‌گذارد.
7. همان activation request دوباره ارسال شود، دوره و payment duplicate تولید نشود؛ کلید تکراری با payload متفاوت رد شود.
8. فعال‌سازی بدون تأیید انسانی پرداخت یا توسط actor فاقد مجوز ممکن نباشد.
9. تمدید پیش از پایان دوره، باقیماندهٔ مدت را از بین نبرد؛ تعلیق/ازسرگیری و grace policy تست شود.
10. plan limits در backend enforce شوند؛ app client نمی‌تواند entitlement جعلی اعلام کند.
11. پایان Trial/اشتراک موجب حذف، پنهان‌شدن یا خراب‌شدن سوابق مالی سازمان نشود. خواندن و export دادهٔ موجود برقرار بماند؛ عملیات حیاتی مالی و queued sync برای ساکنان موجود با policy مستند تست شود.
12. Trial و اشتراک نرم‌افزار در گزارش‌های مالی ساکنان وارد نشود و برعکس.
13. هر تغییر توسط admin دارای actor، زمان، دلیل، traceId و مقدار قبل/بعد در audit باشد.
14. هیچ endpoint، DTO، UI contract یا test، مسیر پرداخت آنلاین/درون‌برنامه‌ای یا لینک پرداخت جایگزین برای کلاینت ایجاد نکند.

### خروجی‌های اجباری این بخش

- `docs/product/subscription-and-entitlements.md` — قواعد Trial، FREE/PRO/BUSINESS، limitها، قیمت‌های تأییدنشده و رفتار انقضا؛
- `docs/security/platform-admin.md` — bootstrap، نقش global، مجوزها و تهدیدهای پنل آینده؛
- `docs/operations/manual-subscription-activation.md` — فرایند عملیاتی تأیید وجه و فعال‌سازی؛
- `docs/architecture/ADR-0010-subscriptions-trials-and-manual-activation.md`;
- OpenAPI schemas/paths، Prisma schema/migrations، service/guard، fixtures و tests مربوط؛
- گزارش واقعی `build`, `lint`, `openapi:validate`, unit و integration tests مربوط به subscriptions.

### معیار عبور

Trial از ثبت سازمان تا پایان و downgrade امن کار کند؛ Platform Admin بتواند پس از بررسی دستی اشتراک را فعال/تمدید کند؛ تمام تغییرات audit شوند؛ محدودیت‌ها در سرور enforce شوند؛ هیچ پرداخت آنلاین/checkout در scope ساخته نشده باشد؛ تست‌های اجباری پاس شوند یا مورد اجرا‌نشده دقیقاً ثبت گردد.

# دستور آغاز برای ایجنت

نام محصول **ESKAN (اسکان)** است. الزامات بخش «چرخهٔ اشتراک، Trial و فعال‌سازی دستی» در ادامهٔ همین سند MUST و الزام‌آور است. از فاز 0 شروع کن. ابتدا مخزن/محیط را با شواهد بررسی و `repository-assessment.md`, `commands.md`, `risks-register.md` و `progress.md` را آماده کن. به‌دنبال ساخت فرانت‌اند نرو. پس از ثبت خط پایه، طبق فازها پیش برو و قرارداد OpenAPI را پیش از تولید endpointهای نهایی طراحی کن. بک‌اند را فقط وقتی تحویل نهایی بده که کد واقعی، migrationها، APIها، تست‌ها، مستندات و دستورهای اجرا فراهم شده باشند و نتایج با فرمان واقعی اثبات شده باشند. اگر موردی اجرا نشده، آن را صریحاً `NOT RUN` ثبت کن. هدف ساخت یک بک‌اند قابل اتکا است، نه تولید بیشترین تعداد فایل.

**پایان مسترپرامپت**
