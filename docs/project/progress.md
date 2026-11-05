# گزارش پیشرفت پروژه — ESKAN Backend

این فایل پس از هر فاز به‌روز می‌شود و وضعیت واقعی را منعکس می‌کند.

## وضعیت کلی

| فاز | عنوان | وضعیت | واژه‌های کلیدی |
|-----|-------|-------|----------------|
| 0   | بررسی مخزن و خط پایه | ✅ انجام شد | ارزیابی محیط و PostgreSQL |
| 1   | تحلیل دامنه و نیازها | ✅ انجام شد | glossary, workflows, requirements |
| 1.5 | Scope lock | ✅ انجام شد | mvp-scope |
| 2   | معماری و ADR | ✅ انجام شد | spike, threat model |
| 3   | قرارداد OpenAPI | ✅ انجام شد (v0.3.0، بازتطبیق با مسترپرامپت v3.0) | contract-first + subscriptions |
| 4   | اسکلت پروژه | ✅ انجام شد (build/test/migration/health واقعی) | nest, prisma, pg |
| 5   | دیتابیس و migration | ✅ انجام شد (۲۵+ جدول، constraint test ۸/۸) | prisma schema |
| 6   | احراز هویت و tenancy | ✅ انجام شد (build/seed/smoke واقعی) | auth, refresh, BOLA |
| 7   | سازمان/لیلیه/اتاق/بستر | ✅ انجام شد (کد + smoke واقعی ۴۲/۴۲) | CRUD, archive |
| 8   | ساکن/قرارداد/تخصیص | ✅ انجام شد (کد + smoke واقعی ۴۸/۴۸) | overlap, concurrency |
| 8.1 | سخت‌سازی صحت/سازگاری (بازبینی) | ✅ انجام شد (P0 fixes + smoke ۱۴۴/۱۴۴ = 42+16+48+14+24) | atomic idempotency, CAS locking, resident overlap, transfer/checkout, fail-fast migration |
| 8.2 | چرخه‌حیات هم‌روندی و یکپارچگی داده | ✅ انجام شد (LockService + business date + overlap contract + smoke ۱۵۷/۱۵۷ = 42+16+48+14+24+13) | resident contract overlap, row locks, business date, idempotency expiry |
| 9   | مالی (charge/payment/deposit) | ⏳ در انتظار | decimal, reversal |
| 10  | مصارف و گزارش | ⏳ در انتظار | reports |
| 11  | idempotency/audit/sync | ⏳ در انتظار | cursor, tombstone |
| 12  | امنیت و سخت‌سازی | ⏳ در انتظار | OWASP, validation |
| 13  | آزمون کامل و کیفیت | ⏳ در انتظار | e2e, reconciliation |
| 14  | عملیات/backup | ⏳ در انتظار | pg_dump, restore |
| 15  | مستندات و تحویل | ⏳ در انتظار | — |
| 16  | گزارش نهایی | ⏳ در انتظار | — |

## فاز 0 — بررسی مخزن و خط پایه (انجام شد)

### هدف
شناخت وضعیت موجود و جلوگیری از تغییر مخرب.

### یافته‌های کلیدی (با شواهد فرمان)
- پوشهٔ `f:\flutter-project\ESKAN` خالی از کد است؛ فقط فایل مسترپرامپت وجود دارد.
- مخزن Git هنوز initialize نشده است (`fatal: not a git repository`).
- Node v24.21.0، npm 11.19.0، Nest CLI 12.0.8 (global)، git 2.52.0.
- Docker نصب نیست.
- PostgreSQL 17.6 محلی نصب و در حال اجراست (`accepting connections`)، auth محلی `trust`.
- همین سرور دیتابیس‌های پروژهٔ دیگری (`weshbazar*`) دارد که لمس نمی‌شوند.

### فایل‌های ساخته‌شده
- `docs/project/repository-assessment.md`
- `docs/project/commands.md`
- `docs/project/risks-register.md`
- `docs/project/progress.md` (همین فایل)

### جدول خط پایه
| فرمان/چک | نتیجه |
|----------|-------|
| node/npm/git/nest/psql version | PASS |
| اتصال PostgreSQL | PASS |
| docker --version | FAIL (نصب نشده) |
| build/test/lint/migration | NOT RUN (پروژه هنوز ساخته نشده) |

### معیار پذیرش فاز 0
- مخزن و محیط شناخته شد: PASS
- شکست‌های اولیه ثبت شد (Docker، عدم وجود پروژه): PASS
- هیچ فایل/داده‌ای حذف نشد: PASS

### Next actions
- فاز 1: تحلیل دامنه و مستندسازی نیازها و ابهامات.
## فاز 1 — تحلیل دامنه و نیازها (انجام شد)

### فایل‌های ساخته‌شده
- `docs/domain/glossary-fa-AF.md`
- `docs/domain/current-workflows.md`
- `docs/domain/target-workflows.md`
- `docs/domain/requirements.md` (REQ-F-001..022، REQ-NF-001..014)
- `docs/domain/open-questions.md` (Q-001..014)
- `docs/domain/assumptions-register.md` (A-001..012)
- `docs/domain/acceptance-scenarios.md` (AS-001..018)

### معیار پذیرش
- حدود MVP/واژه‌نامه/ابهام مالی/نقش‌ها/سناریوها مستند شد: PASS
- قواعد مالی حیاتی روی فرض پنهان تکیه ندارند (assumptions + open-questions): PASS

## فاز 1.5 — Scope lock (انجام شد)

### فایل‌های ساخته‌شده
- `docs/product/mvp-scope.md`

### معیار پذیرش
- scope ثابت شد و قابلیت‌های MUST به requirements وصل شدند: PASS

### Next actions
## فاز 2 — معماری، تهدیدها و ADR (انجام شد)

### فایل‌های ساخته‌شده
- `docs/architecture/architecture-overview.md` (نمودار Mermaid)
- `docs/architecture/data-flow.md`
- `docs/architecture/threat-model.md`
- `docs/architecture/decisions/ADR-0001..0009`

### تصمیمات کلیدی
- Modular Monolith؛ PostgreSQL + Prisma 7.10.1 (stable؛ 8.0.0-rc رد شد).
- Prisma 7 setup جدید: `prisma.config.ts` + generator `prisma-client` +
  driver adapter `@prisma/adapter-pg`.
- auth: JWT access کوتاه‌عمر + refresh opaque rotation (hash در DB).
- tenant isolation از security context؛ پول NUMERIC(19,2) + decimal.js.

### برنامهٔ Spike (اجرا در فاز 4/5)
اثبات زنجیرهٔ NestJS → Prisma → PostgreSQL (migrate + generate + client با
driver adapter) به‌عنوان بخشی از راه‌اندازی واقعی پروژه اجرا و مستند می‌شود.

### Next actions
- فاز 3: ساخت `contracts/openapi.yaml` (contract-first).
- فاز 2: معماری + ADR + technical spike (اتصال NestJS/Prisma به PostgreSQL).
## بازتطبیق با مسترپرامپت v3.0 (2026-10-25)

- قرارداد به `0.3.0` ارتقا یافت؛ حوزهٔ **اشتراک/Trial/Entitlements + Platform Admin**
  اضافه شد (طرح‌ها، `GET /plans`, `GET /subscription/current`, `/subscription/history`,
  و مسیرهای `/api/v1/admin/**`).
- مدل **Money = A-016 (عدد صحیح افغانی)** حفظ شد (تصمیم نهایی مالک؛ بر اصل ۱۰ v3.0 مقدم).
- کد خطای `PLAN_LIMIT_EXCEEDED` اضافه شد.
- اعتبارسنجی: Redocly `exit=0` و js-yaml `exit=0`؛ ۶ هشدار غیرمسدودکننده (سلامت/نسخه/plans
  بدون 4xx، license، example.com).
- مستندات جدید: `docs/project/master-prompt-v3-gap-analysis.md`,
  `docs/product/subscription-and-entitlements.md`, `docs/security/platform-admin.md`,
  `docs/operations/manual-subscription-activation.md`, `ADR-0010`.
- تصمیم‌های باز برای مالک: (۱) تأیید بازگشت مدل پول، (۲) سرنوشت `POST /sync/operations`،
  (۳) قیمت/محدودیت/مدت قطعی Trial.

## فاز 4 — اسکلت پروژه و quality gates (انجام شد، 2026-10-26)

### فرمان‌های واقعاً اجراشده و نتیجه

| فرمان | نتیجه واقعی |
|-------|-------------|
| `npm install` | `added 651 packages` (exit=0)؛ نسخهٔ TypeScript به 6.0.3 تصحیح شد (نیازمند `@nestjs/schematics>=12` به peer `typescript>=6`) |
| `npx prisma generate` | `Generated Prisma Client (7.10.1) to .\src\generated\prisma` |
| `npx prisma migrate dev --name init` | `Your database is now in sync with your schema`؛ جدول `organizations` در `eskan_dev` ساخته شد |
| `npm run build` | exit=0؛ خروجی `dist/main.js` |
| `npm test` | `2 passed, 2 total` (configuration.spec) |
| runtime smoke | `/health/live` → `{status:ok}`؛ `/health/ready` → `{status:ready,database:up}` |

### اصلاحات لازم حین فاز

- TypeScript 6: حذف `baseUrl` (deprecated)، افزودن `esModuleInterop`، افزودن `rootDir: src`
  به tsconfig.build، خروج `prisma.config.ts` از build.
- npm 11: اسکریپت‌های نصب Prisma/engines را مسدود کرد (warning)؛ با `prisma generate`/`migrate`
  تأیید شد که بدون اجرای postinstall هم کار می‌کنند.
- Prisma 7: generator `prisma-client` + `prisma.config.ts` + driver adapter `PrismaPg`.
- حذف `$connect()` از `onModuleInit` (driver adapter اتصال lazy دارد؛ `$connect` بوت را آویزان می‌کرد).

### Known limitation

- e2e (`npm run test:e2e`) به‌دلیل ناسازگاری NestJS 12 (ESM) با Jest 30 (CJS/`require` ESM)
  fail می‌شود؛ runtime health به‌جای آن با اجرای مستقیم سرور + HTTP smoke تأیید شد. حل این
  مورد (babel/swc-jest یا Jest ESM mode) به فاز 13 موکول است.

### تصمیم — پلتفرم‌های هدف کلاینت (2026-10-26)

- هدف اولیهٔ کلاینت ESKAN: **Android** و **Windows Desktop** (Flutter/Dart).
- Backend/API مشترک؛ یک codebase مشترک Flutter؛ UI سازگار؛ آفلاین SQLite/Drift + sync.
- iOS/macOS/Web خارج از اهداف اولیه. در فاز 5 فقط Backend؛ بدون توسعهٔ Flutter.

## فاز 5 — اسکیمای کامل دیتابیس (انجام شد)

- تکمیل `prisma/schema.prisma` بر پایهٔ مدل دامنه و `contracts/openapi.yaml`.
- multi-tenant، مالی integer AFN، sync/outbox، idempotency، audit، اشتراک.

### Next actions
- ادامهٔ فاز 5: migration واقعی + validate/generate/build/test؛ سپس فاز 6 (احراز هویت و tenancy).
## فاز 6 — احراز هویت، tenancy و platform-admin (انجام شد، 2026-11-04)

### فرمان‌های واقعاً اجراشده و نتیجه

| فرمان | نتیجه واقعی |
|-------|-------------|
| `npm install @nestjs/jwt argon2` | exit=0؛ `@nestjs/jwt@12.0.3` و `argon2@0.45.2` نصب شد (بدون postinstall ثانویه) |
| `npm uninstall @nestjs/throttler` | exit=0 (throttling با سرویس in-memory جایگزین شد) |
| `node -e "argon2.hash/verify"` | `ARGON2_OK true` |
| `npx prisma migrate dev --name phase6_platform_admin` | exit=0؛ migration ساخته شد |
| `npx prisma generate` | exit=0؛ کلاینت به `src/generated/prisma` (مدل User/RefreshSession/SubscriptionPlan و… اضافه شد) |
| `npm run build` | exit=0؛ خروجی `dist/main.js` (رفع خطای نوع argon2 با `argon2.HashOptions`) |
| `npm test` | `3 passed, 3 total` فقط `configuration.spec.ts`؛ بقیهٔ specها به‌خاطر محدودیت ESM fail شدند (پایین) |
| `npm run db:seed` | `Seeded 3 subscription plans` (FREE/PRO/BUSINESS)؛ تأیید psql: FREE=1/30/2، PRO=3/300/10، BUSINESS=نامحدود |
| runtime smoke (سرور واقعی) | ۸ سناریو PASS (پایین) |

### سناریوهای smoke واقعی (HTTP روی `node dist/main.js`)

| سناریو | نتیجه |
|--------|-------|
| `POST /auth/register` + `Idempotency-Key` (UUID) | 201 + session (access/refresh/user/memberships) |
| `POST /auth/register` ایمیل تکراری | 409 `BUSINESS_RULE_VIOLATION` |
| `POST /auth/register` بدون Idempotency-Key | 422 `VALIDATION_ERROR` + errors[] |
| `POST /auth/login` | 200 + session |
| `POST /auth/login` رمز اشتباه | 401 `Invalid email or password` (بدون افشای وجود حساب) |
| `GET /auth/me` با Bearer | 200 |
| `GET /auth/me` بدون token | 401 `Missing Authorization header` (Problem Details) |
| `POST /auth/refresh` | 200 + rotation |
| `POST /auth/refresh` توکنِ قبلاً چرخیده | 401 `Refresh token has been reused and was revoked` (ابطال family) |
| `POST /auth/logout` / `logout-all` | 204 |
| `POST /auth/change-password` | 204؛ ورود با رمز قدیم 401 و با رمز جدید 200 |

### نکات فنی

- **Argon2id** با پارامترهای OWASP (`memoryCost=19456`, `timeCost=2`, `parallelism=1`).
- **JWT HS256** کوتاه‌عمر (access) با `iss`/`aud`؛ **refresh token opaque** و فقط SHA-256 آن در DB
  ذخیره می‌شود؛ rotation + تشخیص reuse و ابطال family.
- **ثبت‌نام در یک transaction**: `user` + `organization` + `membership(OWNER)` + `subscription(TRIALING)`
  + `subscriptionEvent`.
- **throttling لاگین**: سرویس in-memory (۵ شکست/۱۵ دقیقه/ایمیل)؛ وابستگی `@nestjs/throttler` حذف شد.
- **Guards**: `JwtAuthGuard` سراسری + `@Public()`؛ `TenantGuard` (selector `X-Organization-Id`)؛
  `RolesGuard`؛ `PlatformAdminGuard` (پشت `isPlatformAdmin`).
- **خطاها**: RFC 9457 Problem Details + `AppError` + global filter + `traceId` middleware.

### تغییرات مهم فایل‌ها

- ساخت: `src/auth/**` (controller/service/module/dto/types/password/token/tenant/login-throttle),
  `src/common/{decorators,errors,filters,guards,http,middleware,validation}/**`.
- تغییر: `src/main.ts`, `src/app.module.ts`, `src/health/health.controller.ts`,
  `src/common/config/configuration.ts`, `prisma/schema.prisma`,
  `prisma/migrations/20261104071954_phase6_platform_admin/migration.sql`,
  `prisma/seed.cjs` (جایگزین `prisma/seed.ts`؛ seed از Prisma 7 `migrations.seed` در `prisma.config.ts` اجرا می‌شود),
  `package.json`, `.env.example`.

### Known limitation (ثبت‌شده برای فاز 13)

- **Jest** (`npm test` و `npm run test:e2e`) به‌خاطر ناسازگاری NestJS 12 (ESM-only با `"type":"module"`)
  با Jest 30 (CJS/`require` ESM پشتیبانی نمی‌شود) نمی‌تواند ماژول‌های `@nestjs/*` را بارگذاری کند.
  فقط `configuration.spec.ts` (بدون import از Nest) اجرا می‌شود (`3 passed`). راه‌حل: swc/babel-jest
  یا Jest ESM mode؛ به فاز 13 موکول شد. تأیید behavior از طریق **سرور واقعی + HTTP smoke** انجام شد.

### Next actions

- فاز 7: APIهای عملیاتی سازمان/لیلیه/اتاق/بستر (CRUD + archive) طبق قرارداد.
## فاز 7 — APIهای عملیاتی سازمان، لیلیه، اتاق و تخت (انجام شد، 2026-11-04)

### فرمان‌های واقعاً اجراشده و نتیجه

| فرمان | نتیجه واقعی |
|-------|-------------|
| `npm run build` | exit=0 (بدون خطای TS) |
| `node scripts/smoke-phase7.cjs` (integration smoke روی سرور واقعی) | **42/42 PASS** |
| `npm test` | `3 passed` فقط `configuration.spec.ts`؛ 4 suite به‌خاطر محدودیت ESM fail شدند (Known limitation) |
| `npm run openapi:validate` (Redocly) | valid؛ ۶ هشدار غیرمسدودکنندهٔ پیش‌موجود |
| js-yaml parse | OK؛ `paths=74, schemas=97, version=0.3.0` |

### endpointهای تکمیل‌شده

- **سازمان**: `GET /organizations/current`، `PATCH /organizations/current` (X-Expected-Version)،
  `GET /organizations/current/members`، `PATCH /organizations/current/members/{membershipId}` (فقط OWNER).
- **لیلیه**: `GET/POST /hostels`، `GET/PATCH /hostels/{hostelId}`، `POST /hostels/{hostelId}/archive`.
- **اتاق**: `GET/POST /hostels/{hostelId}/rooms`، `GET/PATCH /rooms/{roomId}`، `POST /rooms/{roomId}/archive`.
- **تخت**: `GET/POST /rooms/{roomId}/beds`، `GET/PATCH /beds/{bedId}`، `POST /beds/{bedId}/deactivate`.

### نکات امنیتی و چندسازمانی (تأیید smoke)

- همهٔ query/mutation با `organizationId` از `MembershipContext` (نه از body/پارامتر) filter می‌شوند.
- `X-Organization-Id` فقط selector است؛ `TenantGuard` عضویت فعال را در DB تصدیق می‌کند (نبودن → 403، یا 404 بدون افشای منبع).
- دسترسی cross-tenant با تغییر UUID یا header → 404/403 (تأیید شد).
- نقش‌ها: خواندن برای همهٔ اعضا؛ create/update/archive لیلیه/اتاق/تخت → `OWNER, ADMIN`؛
  ویرایش پروفایل سازمان و مدیریت اعضا → فقط `OWNER`.
- قانون «آخرین OWNER قابل تنزل/غیرفعال‌شدن نیست» (409) پیاده‌سازی شد.

### یکپارچگی داده و قواعد کسب‌وکار

- `Idempotency-Key` (UUID) در ایجاد لیلیه/اتاق/تخت: replay پاسخ قبلی؛ payload متفاوت → 409 `IDEMPOTENCY_KEY_REUSED`؛ بدون کلید → 422.
- `X-Expected-Version` در PATCH: نسخهٔ قدیمی → 409 `RESOURCE_VERSION_CONFLICT`.
- کد تکراری اتاق در لیلیه / تخت در اتاق → 409 `DUPLICATE_CODE`.
- archive/deactivate بدون حذف سوابق:
  - لیلیه با اتاق فعال → 409 `RESOURCE_HAS_ACTIVE_ASSIGNMENT`.
  - اتاق با تخت فعال → 409.
  - تخت با تخصیص فعال → 409.
- خطاها با Problem Details (RFC 9457) و traceId (401/403/404/409/422 تأیید شد).

### ساختار کد

- `src/organizations/**`, `src/hostels/**`, `src/rooms/**`, `src/beds/**` (module/service/controller/dto).
- `src/common/common.module.ts` (export مشترک guards + idempotency + re-export AuthModule)،
  `src/common/idempotency/idempotency.service.ts`، `src/common/http/http-utils.ts`،
  `src/common/prisma/unique-violation.ts`.
- `src/app.module.ts`: import ماژول‌های جدید.
- `scripts/smoke-phase7.cjs`: تست integration تکرارپذیر (جایگزین e2e به‌خاطر محدودیت Jest).

### Known limitation (بدون تغییر)

- Jest 30 + NestJS 12 (ESM): `npm test`/`test:e2e` نمی‌تواند ماژول‌های `@nestjs/*` را load کند؛
  فقط `configuration.spec.ts` اجرا می‌شود. تأیید رفتار از طریق `scripts/smoke-phase7.cjs` روی سرور واقعی
  انجام شد (42/42 PASS). رفع Jest به فاز 13 موکول است.

### تصمیم پلتفرم (حفظ‌شده)

- کلاینت هدف ESKAN: **Android** و **Windows Desktop** (Flutter/Dart)؛ Backend/API مشترک.
  در فاز 7 فقط Backend؛ بدون توسعهٔ Flutter.

### Next actions

- فاز 8 به‌طور موقت **متوقف** شد؛ نخست «بازبینی دامنهٔ محصول» انجام و مستند شد (بخش زیر).
## بازبینی دامنهٔ محصول پیش از فاز ۸ — انجام شد (2026-11-04)

- **تصمیم:** فاز ۷ تکمیل‌شده محسوب شد (کامیت `5ea0667`)؛ **فاز ۸ آغاز نشد.** به‌جای آن بازبینی دامنهٔ ESKAN برای بازار افغانستان انجام شد.
- **قید اجرایی:** هیچ migration جدید، تغییر Prisma Schema، یا تغییر OpenAPI/کد اجرایی انجام **نشد**. فقط تحقیق/تحلیل/مستندسازی.

### اسناد جدید

1. `docs/research/afghanistan-private-hostel-operating-model.md` — یافته‌های تحقیق بازار با منابع و تفکیک اعتبار.
2. `docs/product/hostel-service-packages-and-absence-policy.md` — بستهٔ اقامت + سیاست غیابت موقت.
3. `docs/product/hostel-domain-requirements-v1.md` — نیازمندی‌های دامنه (وضعیت EXISTING/PARTIAL/MISSING/NEEDS_REDESIGN/FUTURE).
4. `docs/architecture/domain-model-and-workflows.md` — مدل موجودیت‌ها و جریان‌های کاری.
5. `docs/api/api-gap-analysis-v0.3.md` — شکاف بین API/Schema/کد و نیازها.
6. `docs/product/mvp-prioritization.md` — P0/P1/P2.

### یافته‌های کلیدی (شکاف اصلی)

- **بستهٔ اقامت** (اقامت/اعاشه/خدمات با اجزای مالی و پرچم «قابل‌کسر در غیاب») — MISSING.
- **غیابت موقت** (`TemporaryAbsence` + Credit/Adjustment) — MISSING.
- **پرداخت‌کننده جدا از ساکن** (`Payer`) — MISSING.
- **وضعیت نگهداری اتاق/تخت** + درخواست تعمیر/نظافت — MISSING (مسترپرامپت فقط `maintenance_requests` را «در صورت شمول MVP» داشت).
- **تماس اضطراری ساکن** و **تنظیمات عملیاتی لیلیه** — MISSING.
- پلتفرم دستگاه Android/Windows — **برطرف‌شده** (در فاز ۷ ثابت شد).

### تصمیم‌های باز برای مالک

- آیا «بستهٔ اقامت + غیابت موقت» به قرارداد v0.4 اضافه شود؟
- مقدار پیش‌فرض «حداقل روز غیابت» (پیشنهاد ۳ روز برای پایلوت) و سیاست کسر.
- کدام فیلدها P0 اجباری و کدام P1.

### Next actions

- قرارداد v0.4.0 + schema تکمیل شد (بخش زیر)؛ آمادهٔ آغاز فاز ۸.

## اصلاح قرارداد v0.4.0 + schema (2026-11-04) — مبنای فاز ۸

بازبینی دامنه تأیید شد و طراحی‌های ناقص **فقط در لایهٔ قرارداد/دیتابیس** (نه کد فازهای قبل) اصلاح شد:

| تغییر | لایه | منطقِ پیاده‌سازی |
|---|---|---|
| `AccommodationPackage` + `AccommodationPackageComponent` | contract + schema | فاز ۸/۹ |
| `StayContract.packageId` + `packageSnapshot` | schema | فاز ۹ (محاسبهٔ بسته) |
| `TemporaryAbsence` + `AbsenceStatus` + credit (`ChargeType.ADJUSTMENT`) | contract + schema | فاز ۹ |
| پرداخت‌کنندهٔ جدا (`payerName/Phone/Relation`) | contract + schema | فاز ۹ |
| `maintenanceStatus` اتاق/تخت (`MaintenanceStatus`) | contract + schema | فاز ۱۱ |
| تماس اضطراری ساکن | contract + schema | فاز ۸ |
| تنظیمات لیلیه (`contactPhone`, `absenceMinDays`, `rentDueDayOfMonth`, `defaultRentAmount`) | contract + schema | فاز ۸ |

### اعتبارسنجی واقعی

| چک | نتیجه |
|---|---|
| `npx prisma validate` | ✅ exit=0 |
| `npx prisma migrate dev --name service_packages_absence_operational_status` | ✅ اعمال شد (migration `20261104151922_...`) |
| `npx prisma generate` → `npm run build` | ✅ exit=0 |
| js-yaml parse | ✅ `version=0.4.0, paths=78, schemas=107` |
| Redocly lint | ✅ valid؛ ۶ هشدار پیش‌موجود |
| `scripts/smoke-phase7.cjs` (رگرسیون) | ✅ 42/42 PASS |

### ترتیب فازها (نهایی)

- **فاز ۸:** ساکنان، پذیرش، قرارداد (+بسته)، تخصیص تخت، انتقال/Check-out.
- **فاز ۹:** شارژ/پرداخت/ودیعه/مصارف + منطق مالی بسته‌ها و غیابت (credit).
- **فاز ۱۰:** گزارش‌ها، داشبورد، رسید، صندوق ساده.
- **فاز ۱۱:** تعمیرات، نظافت، وضعیت عملیاتی پیشرفته.

### تأیید نهایی مالک (2026-11-04)

تمام پنج تغییر بنیادین v0.4 **تأیید** شدند؛ بسته به‌عنوان جزء اصلی مدل قرارداد، غیابت مستقل از خروج،
پرداخت‌کنندهٔ ساده روی Payment، وضعیت نگهداری مستقل از اشغال، و تماس اضطراری اختیاری. سیاست غیابت
(حداقل ۳ روز قابل‌تنظیم، کسر از اولین روز کامل، فقط اجزای `deductibleOnAbsence=true`، credit پس از تأیید
بازگشت واقعی، بدون بازنویسی) ثبت شد. endpoint مستقل `POST /packages/{packageId}/archive` نیز به قرارداد
اضافه شد (بستهٔ آرشیوشده برای قرارداد جدید قابل انتخاب نیست؛ snapshot قبلی دست‌نخورده می‌ماند).

### Next actions

- شروع فاز ۸ طبق قرارداد v0.4.0 (ساکن/پذیرش/قرارداد+بسته/تخصیص/انتقال/Check-out).
## فاز ۸ — ساکنان، قرارداد+بسته، تخصیص تخت، انتقال/Check-out (2026-11-04)

وضعیت فاز: **تکمیل و اعتبارسنجی‌شده (با شواهد واقعی)** — کامیت مستقل در انتهای گزارش.

### ماژول‌های پیاده‌سازی‌شده

| ماژول | endpointهای اصلی | نکات کلیدی |
|---|---|---|
| `residents` | `GET/POST /residents`, `GET/PATCH /residents/:id`, `POST /residents/:id/archive`, `GET /residents/:id/timeline` | تماس اضطراری اختیاری؛ بدون unique اجباری روی phone؛ archive فقط بدون قرارداد/تخصیص فعال |
| `contracts` | `GET/POST /contracts`, `GET/PATCH /contracts/:id`, `POST .../activate`, `POST .../terminate`, `listByResident` | DRAFT→ACTIVE→TERMINATED؛ update فقط DRAFT؛ snapshot اجزای بسته server-side |
| `assignments` | `POST /bed-assignments`, `POST .../end`, `GET /residents/:id/assignments` | overlap نیمه‌باز `[start,end)`؛ بلوک بستر خراب؛ concurrency-safe |
| `packages` (تکمیل) | `maintenanceStatus` به بستر اضافه شد تا تست «بستر خراب» ممکن شود | — |

### تصمیم‌ها و منطق دامنه

- **بستهٔ اقامت = منبع snapshot:** قرارداد هنگام انتخاب بستهٔ فعال، اجزا را با نوع/نام/مبلغ/`deductibleOnAbsence` در `packageSnapshot` ثبت می‌کند؛ تغییر/آرشیو بعدی بسته روی قرارداد قبلی اثر ندارد (تست «snapshot stable»).
- **Reconcile مبلغ:** اگر بسته انتخاب شود، `rent.amount` باید دقیقاً برابر مجموع اجزای بسته باشد؛ اختلاف → 422 (`rent.amount`).
- **بستهٔ آرشیوشده** برای قرارداد جدید قابل انتخاب نیست (404).
- **Overlap `[startDate, endDate)`:** migration `20261104180000_bed_assignment_half_open_range` مسیر exclusion را از `[]` به `[)` تغییر داد تا same-day handoff ممکن شود. race با transaction + exclusion `23P01` مهار می‌شود.
- **قرارداد فعال شرط تخصیص** است (`CONTRACT_NOT_ACTIVE`)؛ ساکن/بستر/قرارداد باید هم‌سازمان و هم‌hostel باشند.
- **transfer/checkout = ترکیب endpointهای موجود** (end assignment → terminate contract) بدون endpoint اختصاصی؛ سابقهٔ assignment حفظ می‌شود.
- «پذیرش منسجم» از طریق زنجیرهٔ resident → contract(activate) → assignment با اعتبارسنجی cross-entity تأمین می‌شود؛ Charge/Payment در فاز ۸ ساخته نمی‌شود.

### اعتبارسنجی واقعی

| چک | نتیجه |
|---|---|
| `npx prisma migrate dev --name bed_assignment_half_open_range` | ✅ اعمال شد (`20261104180000_...`؛ DB در sync) |
| `npm run build` | ✅ exit=0 (بدون خطای TS/DI) |
| `scripts/smoke-phase8.cjs` (سرور واقعی) | ✅ **48/48 PASS** |
| `scripts/smoke-phase7.cjs` (رگرسیون) | ✅ **42/42 PASS** |
| `npm run openapi:validate` (Redocly) | ✅ valid؛ ۶ هشدار پیش‌موجود |
| js-yaml parse | ✅ (قرارداد بدون تغییر؛ v0.4.0) |
| `npm test` | ⚠️ `3 passed` فقط `configuration.spec.ts`؛ ۴ suite از محدودیت Jest 30/NestJS 12 (ESM) |

### پوشش تست‌های پذیرش فاز ۸

- ✅ دسترسی cross-tenant به resident (`404`)؛ انتخاب بستهٔ سازمان دیگر/آرشیوشده؛ مبلغ متناقض.
- ✅ تخصیص هم‌زمان یک تخت (دو درخواست موازی) → یک `201` و یک `409 BED_ASSIGNMENT_OVERLAP`.
- ✅ تخصیص بستر خراب (`OUT_OF_SERVICE`) → `409`؛ قرارداد غیرفعال → `409 CONTRACT_NOT_ACTIVE`؛ ساکن/قرارداد mismatch → `409`.
- ✅ idempotency (replay/conflict/422) برای resident/contract/assignment.
- ✅ same-day handoff؛ انتقال (end حفظ سابقه)؛ Check-out (terminate پس از پایان تخصیص)؛ archive ساکن تمیز/دارای قرارداد فعال.
- ✅ snapshot ثابت پس از تغییر بسته.

### Known limitations (ثبت‌صریح)

- **Jest 30 + NestJS 12 (ESM):** تست‌های ماژول‌های Nest با `npm test` اجرا نمی‌شوند؛ رفتار با smoke واقعی + رگرسیون تأیید شد. رفع به فاز ۱۳ موکول است.
- **شمارهٔ قرارداد** فعلاً `CNT-` + هشت‌گانهٔ تصادفی (بدون sequence رسمی در محدودهٔ org)؛ سیاست sequence/شماره برای رسیدها در فاز ۹ تثبیت می‌شود.
- **هشدار رکورد تکراری ساکن** (نام/شماره مشابه) فعلاً فقط «ثبت اجازه» است نه «هشدار در پاسخ»؛ نیازمند فیلد `warnings` در قرارداد است (به فاز بعد موکول).

### Next actions

- فاز ۹: Charge/Payment/Allocation/Reversal + Deposit + Expense + منطق credit غیابت (بر پایهٔ snapshot بسته و مدل v0.4).
## فاز 8.1 — سخت‌سازی صحت/سازگاری (انجام شد)

### هدف
بستن یافته‌های P0 بازبینی خارجی پیش از شروع فاز مالی ۹.

### تغییرات کد
- `src/common/validation/date.ts` + `is-date-only.decorator.ts`: اعتبارسنجی سخت `YYYY-MM-DD` (رد `2026-02-31`) در DTOهای قرارداد/تخصیص/انتقال.
- `hostels.service`/`rooms.service`: فیلدهای v0.4 (`contactPhone`, `defaultRentAmount`, `rentDueDayOfMonth`, `absenceMinDays`, `maintenanceStatus`) ذخیره/بازگشت.
- قفل خوش‌بینانه اتمی (compare-and-swap) با `updateMany({ where: { version } })` در org/hostel/room/bed/package/resident/contract؛ `count === 0 → 409 RESOURCE_VERSION_CONFLICT`.
- idempotency اتمی: `IdempotencyService.runAtomic` (claim → mutate → complete در یک transaction)؛ duplicate key → replay ذخیره‌شده بدون اثر جانبی؛ retention ۳۰ روزه برای صف آفلاین (غیر مالی).
- هم‌پوشانی ساکن: چک app-level + exclusion constraint مهاجرت `20261104190000_bed_assignment_resident_no_overlap` (بدون backfill؛ fail-fast برای ناسازگاری‌های پیشین).
- parent archive/maintenance: ساخت فرزند زیر hostel/room آرشیوشده و تخصیص روی room/hostel آرشیو/خارج‌سرویس ممنوع شد.
- transfer (پایان + شروع در یک transaction) و checkout (پایان تخصیص + close قرارداد اتمی، حفظ سابقه) + قرارداد OpenAPI به‌روز شد.
- refresh rotation هم‌روند امن شد (compare-and-swap روی session قدیمی).
- `X-Organization-Id` هنگام چند عضویت فعال اجباری شد (`ORGANIZATION_CONTEXT_REQUIRED`).

### رفع P0های بازبینی 8.1
- **رفرش‌چرخش توکن:** توکن جدید پیش از تراکنش ساخته و در همان family ذخیره می‌شود؛ old→new لینک می‌شود؛ session قدیمی با compare-and-swap claim می‌شود؛ raw token جدید برمی‌گردد. بازندهٔ هم‌روندی به‌عنوان 401 برگشت داده می‌شود **بدون** ابطال family؛ reuse واقعی (ارائهٔ توکنِ ازقبل‌چرخیده) همچنان در pre-check کل family را ابطال می‌کند.
- **تخصیص `create`:** replay های idempotency پیش از هر خوانش دامنه بررسی می‌شود؛ check وضعیت خطیر (`assertAssignable`) داخل transaction اجرا می‌شود؛ بازهٔ تاریخ قرارداد اعتبارسنجی می‌شود؛ double-assignment هم‌روند مهار می‌شود.
- **انتقال (transfer):** `Idempotency-Key` الزامی شد؛ با `IdempotencyService.runAtomic` اتمی اجرا می‌شود؛ تاریخ انتقال نسبت به تخصیص فعلی و تاریخ‌های قرارداد اعتبارسنجی می‌شود؛ تخصیص قدیمی با CAS پایان می‌یابد؛ وضعیت/هم‌پوشانی بستر/اتاق/لیلیهٔ مقصد بررسی می‌شود؛ تخصیص جدید ساخته می‌شود.
- **`end` تخصیص و `activate`/`terminate`/`checkout` قرارداد:** به CAS و many-update تراکنشی تبدیل شدند (با idempotency در موارد لازم).
- **قرارداد `resolve`/`create`:** اعتبارسنجی `endDate > startDate`، الزام فعال‌بودن ساکن، و replay پیش از خوانش دامنه اضافه شد. `update` ابتدا وضعیت/نسخه را چک می‌کند تا قرارداد غیر-DRAFT همیشه 409 صحیح بگیرد (نه خطای نامربوط).
- **مهاجرت `20261104190000`:** backfill خاموش حذف شد؛ CHECK سلامت بازه (`end_date > start_date`) و exclusion در سطح resident اضافه شد؛ سطرهای موجود mutate نمی‌شوند و conflict/بازهٔ نامعتبر پیشین **fail-fast** می‌کند تا اپراتور صریحاً رفع‌و‌رجوع کند.
- **OpenAPI:** `Idempotency-Key` روی `assignmentTransfer` الزامی شد.

### اعتبارسنجی واقعی
- `npx prisma validate` ✅ (schema معتبر) و `npx prisma generate` ✅ (Prisma 7.10.1).
- `npx prisma migrate dev` ✅ — پس از پاک‌سازی دادهٔ تست نامعتبرِ dev (رکوردهای `end_date <= start_date`) خارج از مهاجرت؛ مهاجرت خود fail-fast باقی می‌ماند.
- `npm run build` ✅ exit=0.
- `npm run openapi:validate` ✅ (معتبر؛ ۶ warning از پیش‌موجود).
- Smoke واقعی، همگی PASS:
  - `smoke-phase7` ✅ **۴۲/۴۲**
  - `smoke-phase8-packages` ✅ **۱۶/۱۶**
  - `smoke-phase8` ✅ **۴۸/۴۸**
  - `smoke-phase81` ✅ **۱۴/۱۴**
  - `smoke-phase82` ✅ **۲۴/۲۴** (رفرش هم‌روند + reuse/ابطال family، idempotency/اتمی بودن transfer، تاریخ‌های خارج از بازهٔ قرارداد، replay پس از checkout، idempotency/CAS فعال‌سازی/خاتمه/checkout)

## فاز 8.2 — چرخه‌حیات هم‌روندی و یکپارچگی داده (انجام شد)

### هدف
پیش‌نیاز فاز مالی ۹: یکپارچگی داده‌ها در مسیرهای چرخه‌حیات (ساخت/فعال‌سازی/خاتمه/checkout تخصیص و قرارداد) با قفل‌گذاری سطری و «تاریخ کسب‌وکار» و ممانعت از قرارداد ACTIVE هم‌پوشان برای یک ساکن.

### تصمیم
- **سیاست هم‌پوشانی قرارداد:** هر ساکن حداکثر یک قرارداد ACTIVE بدون هم‌پوشانی با بازهٔ نیمه‌باز `[startDate, endDate)`؛ `endDate = null` یعنی بی‌نهایت؛ قراردادهای DRAFT مستثنا هستند. خطای `RESIDENT_CONTRACT_OVERLAP`.

### تغییرات کد
- `src/common/concurrency/lock.service.ts` (جدید): قفل ردیف `SELECT ... FOR UPDATE` با ترتیب سراسری Hostel → Room → Bed → Resident → Contract.
- `src/common/date/business-date.ts` (جدید): `businessTodayForOrg` با `Intl.DateTimeFormat` و timezone سازمان (`Asia/Kabul`) بدون وابستگی به ساعت سرور؛ `DEFAULT_TIMEZONE`.
- `src/common/common.module.ts`: ثبت و export `LockService`.
- `src/common/errors/error-codes.ts`: افزودن `RESIDENT_CONTRACT_OVERLAP`.
- `src/common/idempotency/idempotency.service.ts`: انقضای lazy در `getReplay` (رکورد منقضی درجا حذف و «غایب» تلقی می‌شود).
- `assignments.service.ts`/`contracts.service.ts`: قفل‌گذاری create/transfer/activate/terminate/checkout؛ `resolve` قرارداد تراکنشی شد؛ `end` تخصیص و `checkout` قرارداد با «تاریخ کسب‌وکار» به‌جای `new Date()`؛ `assertNoActiveOverlap` ساکن.
- `rooms/beds/packages/residents.service.ts`: parent-lock در ساخت فرزند (room/bed/package) و قفل resident در archive (مهار race با ساخت قرارداد/تخصیص).
- `contracts/openapi.yaml` + `docs/api/error-model.md`: افزودن `RESIDENT_CONTRACT_OVERLAP` به enum خطا.
- مهاجرت `20261104195000_stay_contract_active_resident_no_overlap`: `EXCLUDE USING gist` روی `stay_contracts` برای `resident_id` با `daterange(..., '[)')` فقط‌جا که `status = 'ACTIVE'` (بدون mutate سطرهای موجود؛ fail-fast).
- `auth.service.ts`: تفکیک «استفادهٔ مجدد هم‌روند» از «استفادهٔ مجدد واقعی» در refresh (reuse واقعی family را ابطال می‌کند؛ بازندهٔ هم‌روندی تنها 401 می‌شود).

### اعتبارسنجی واقعی
- `npm run build` ✅ exit=0.
- `npx prisma migrate deploy` ✅ (پس از رفع دو قرارداد ACTIVE هم‌پوشانِ دادهٔ dev خارج از مهاجرت؛ مهاجرت fail-fast ماند).
- `npm run openapi:validate` ✅ (معتبر؛ ۶ warning از پیش‌موجود).
- Smoke واقعی، همگی PASS:
  - `smoke-phase7` ✅ **۴۲/۴۲**
  - `smoke-phase8-packages` ✅ **۱۶/۱۶**
  - `smoke-phase8` ✅ **۴۸/۴۸**
  - `smoke-phase81` ✅ **۱۴/۱۴**
  - `smoke-phase82` ✅ **۲۴/۲۴**
  - `smoke-phase83` ✅ **۱۳/۱۳** (فعال‌سازی هم‌روند دو قرارداد هم‌پوشان → یک 409 RESIDENT_CONTRACT_OVERLAP، تاریخ کسب‌وکار در end/checkout، race تخصیص vs terminate، انقضای lazy idempotency، parent-lock revalidation)

## فاز 8.2.1 — بستن نهایی یکپارچگی چرخه‌حیات (انجام شد)

### هدف
پس از ممیزی مستقل، چند race و نقص مرزی باقی‌مانده در archiving، deactivate، activate/update قرارداد، انتقال، checkout و زمان‌سنجی اعتبارسنجی بسته شد تا Charge/Payment فاز مالی روی دادهٔ معتبر ساخته شوند.

### تصمیم
- `hostelId`/`residentId` قرارداد پس از ساخت **تغییرناپذیر** شد؛ انتقال ساکن/لیلیه با ساخت قرارداد جدید انجام می‌شود (یکپارچگی مالی فاز ۹ هم مستحکم‌تر است).
- بازهٔ قرارداد نیمه‌باز `[startDate, endDate)` در `assertAssignable` و `transfer` با تابع مشترک `assertRangeWithinContract` اعمال شد (رد startDate == endDate).

### تغییرات کد
- `hostels/rooms/beds.service.ts`: archive/deactivate به تراکنش + قفل ردیف والد تبدیل شدند (`lockHostel`/`lockRoom`/`lockBed`) و شمارش فرزند/تخصیص **پس از قفل** بازبینی می‌شود؛ Hostel archive اکنون قرارداد ACTIVE و تخصیص ACTIVE را هم بررسی می‌کند.
- `contracts.service.ts`: update ابتدا تغییر hostel/resident را رد می‌کند و قفل قرارداد می‌گیرد؛ activate پس از قفل، قرارداد را **دوباره** می‌خواند و با CAS روی `status + version` فعال می‌کند؛ checkout با قفل ردیف، بازبینی پایان‌پذیری در برابر `startDate` قرارداد و `startDate` تخصیص‌های فعال، و CAS نسخه‌ای بسته شد.
- `assignments.service.ts`: transfer مقصد را پس از قفل دوباره می‌خواند، `transitionStart <= startDate` را رد می‌کند، و بازهٔ انتقال/انتهای جدید را در برابر بازهٔ قرارداد بررسی می‌کند.
- `business-date.ts` + `is-timezone.decorator.ts`: اعتبارسنجی IANA timezone در آپدیت organization (رد `INVALID_ZONE` با 422).
- `auth.service.ts`: ساخت payload پاسخ پیش از چرخش refresh انجام می‌شود تا شکست پس از commit، token خام جدید را گم نکند.
- مهاجرت `20261105100000_stay_contract_date_range_check`: `CHECK (end_date IS NULL OR end_date > start_date)` برای `stay_contracts` (fail-fast، بدون mutate).
- `docs/api/idempotency.md`: scope واقعی unique (`organizationId + idempotencyKey + endpoint`) و تفاوت lazy-expiry با پاک‌سازی فیزیکی مستند شد.

### اعتبارسنجی واقعی
- `npm run build` ✅ exit=0.
- `npx prisma migrate deploy` ✅ (مهاجرت date-range اعمال شد).
- Smoke واقعی، همگی PASS:
  - `smoke-phase7` ✅ **۴۲/۴۲**
  - `smoke-phase8-packages` ✅ **۱۶/۱۶**
  - `smoke-phase8` ✅ **۴۸/۴۸**
  - `smoke-phase81` ✅ **۱۴/۱۴**
  - `smoke-phase82` ✅ **۲۴/۲۴**
  - `smoke-phase83` ✅ **۱۳/۱۳**
  - `smoke-phase84` ✅ **۲۲/۲۲** (race واقعی room↔bed و hostel↔room و bed↔assignment با بررسی وضعیت نهایی DB، update↔activate، immutability قرارداد، مرزهای تاریخ transfer/checkout، timezone نامعتبر)

### Next actions
- فاز ۹ مالی.