# گزارش پیشرفت پروژه — ESKAN Backend

این فایل پس از هر فاز به‌روز می‌شود و وضعیت واقعی را منعکس می‌کند.

## وضعیت کلی

| فاز | عنوان | وضعیت | واژه‌های کلیدی |
|-----|-------|-------|----------------|
| 0   | بررسی مخزن و خط پایه | ✅ انجام شد | ارزیابی محیط و PostgreSQL |
| 1   | تحلیل دامنه و نیازها | ✅ انجام شد | glossary, workflows, requirements |
| 1.5 | Scope lock | ✅ انجام شد | mvp-scope |
| 2   | معماری و ADR | ✅ انجام شد | spike, threat model |
| 3   | قرارداد OpenAPI | ✅ انجام شد (نسخهٔ فعلی **0.5.0**؛ ارتقا از v0.3.0) | contract-first + subscriptions |
| 4   | اسکلت پروژه | ✅ انجام شد (build/test/migration/health واقعی) | nest, prisma, pg |
| 5   | دیتابیس و migration | ✅ انجام شد (۲۵+ جدول، constraint test ۸/۸) | prisma schema |
| 6   | احراز هویت و tenancy | ✅ انجام شد (build/seed/smoke واقعی) | auth, refresh, BOLA |
| 7   | سازمان/لیلیه/اتاق/بستر | ✅ انجام شد (کد + smoke واقعی ۴۲/۴۲) | CRUD, archive |
| 8   | ساکن/قرارداد/تخصیص | ✅ انجام شد (کد + smoke واقعی ۴۸/۴۸) | overlap, concurrency |
| 8.1 | سخت‌سازی صحت/سازگاری (بازبینی) | ✅ انجام شد (P0 fixes + smoke ۱۴۴/۱۴۴ = 42+16+48+14+24) | atomic idempotency, CAS locking, resident overlap, transfer/checkout, fail-fast migration |
| 8.2 | چرخه‌حیات هم‌روندی و یکپارچگی داده | ✅ انجام شد (LockService + business date + overlap contract + smoke ۱۵۷/۱۵۷ = 42+16+48+14+24+13) | resident contract overlap, row locks, business date, idempotency expiry |
| 9   | مالی (charge/payment/deposit) | ⏳ در انتظار — فقط سرویس‌های مالی M3 (قرارداد Gate 1، M-2 و 4c چرخه‌حیات/Idempotency ✅ انجام شد) | decimal, reversal |
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

## فاز 8.2.2 — سخت‌سازی نهایی پیش از طراحی فاز ۹ (انجام شد)

در پاسخ به ممیزی مستقل روی commit `ef96de3`، چند ریسک P1/P2 باقی‌مانده بسته شد:

- **نگهداری (maintenance) بستر/اتاق:** `BedsService.update`/`RoomsService.update` تراکنشی +
  قفل سطری شدند و تغییر به `OUT_OF_SERVICE`/`NEEDS_REPAIR` وقتی تخصیص ACTIVE وجود دارد
  با `409 RESOURCE_HAS_ACTIVE_ASSIGNMENT` رد می‌شود.
- **آخرین Owner:** `OrganizationsService.updateMember` در تراکنش + `lockOrganization`،
  شمارش Owner پس از قفل؛ race هم‌روند دو demote دیگر نمی‌تواند سازمان را بدون Owner رها کند.
- **Idempotency ثبت‌نام (واقعی):** `register` با بررسی رمز عبور، retry ثبت‌نامِ گم‌شده را
  با session تازه بازیابی می‌کند (بدون ذخیرهٔ token خام)؛ duplicate هم‌روند email نیز مدیریت شد.
- **Refresh:** تفکیک `REFRESH_TOKEN_REUSED` از `REFRESH_TOKEN_ROTATION_CONFLICT` در پاسخ؛
  سیاست «بدون تضعیف امنیت token خام» حفظ شد (بازیابی کامل در فاز مالی/انتشار مستند شده).
- **OpenAPI:** رفع `organizationId` گم‌شده/`memberships` زائد در `StayContract`/`BedAssignment`/`Charge`،
  مستندسازی IANA timezone و immutability `hostelId`/`residentId` قرارداد، افزودن دو code خطا.

### اعتبارسنجی واقعی
- `npm run build` ✅ exit=0.
- `npx prisma migrate deploy` ✅ (بدون مهاجرت جدیدِ معلق).
- `npm run openapi:validate` ✅ (معتبر؛ ۶ warning از پیش‌موجود).
- Smoke واقعی، همگی PASS:
  - `smoke-phase82` ✅ **۲۴/۲۴**، `smoke-phase83` ✅ **۱۳/۱۳**، `smoke-phase84` ✅ **۲۲/۲۲**
  - `smoke-phase85` ✅ **۹/۹** (register replay، maintenance guard بستر/اتاق، کد refresh، race آخرین owner + بررسی DB)
- NOTE: unit-test `jest` در Node 24 به‌دلیل ESM-only بودن پکیج‌های NestJS v12 به `--experimental-vm-modules` نیاز دارد؛ در Gate 0 با `scripts/run-jest.cjs` رفع و پایدار شد.

## پلان مهندسی فاز ۹ — اجرا
- مرجع اجرایی: `ESKAN_PHASE9_EXECUTION_DIRECTIVE_v1_FA.md` (تصمیم‌های D-01..D-18 **تصویب‌شده و قطعی**).
- سند طراحی: `docs/project/phase-9-engineering-plan.md` (نسخهٔ **0.3 — Design Lock**).
- **Gate 0 — Baseline (اجرا شد):**
  - شاخهٔ اجرایی `feat/phase-9-financial` از `a1374eb`.
  - **Jest/ESM رفع شد:** پکیج‌های NestJS v12 فقط ESM هستند؛ Jest 30 مسیر native `require(esm)` دارد که فقط با `--experimental-vm-modules` فعال می‌شود. `scripts/run-jest.cjs` این flag را در `NODE_OPTIONS` ست می‌کند و اسکریپت‌های `test`/`test:e2e` از آن عبور می‌کنند.
  - **bug واقعی رفع شد:** `AppError.message` پیش‌تر `"App Error"` (برگرفته از نام کلاس توسط NestJS) بود؛ حالا برابر `detail` است.
  - پوشش unit-test بازسازی شد (mock تعاملی `$transaction` + assertion ناهم‌گام refresh).
  - **CI واقعی** `.github/workflows/ci.yml`: install + generate + build + OpenAPI + Prisma validate + unit + `migrate deploy` + e2e smoke روی PostgreSQL 17.
  - اعتبارسنجی: build ✅، `openapi:validate` ✅ (۶ warning)، `prisma validate` ✅، `migrate status` ✅ (۸ migration)، unit **۲۶/۲۶** ✅، e2e smoke **۲/۲** ✅.
- **Gate 1 — Contract (✅ قفل رسمی — 2026-11-07):**
  - `contracts/openapi.yaml` برای رفع تناقض‌های گزارش ممیزی اصلاح شد؛ `openapi:validate` ✅ (valid، ۶ warning از پیش‌موجود).
  - **Receipt/Payment/Allocation:** `PaymentRequest` دیگر `receiptNumber` و آرایهٔ `allocations` نمی‌پذیرد؛ پرداخت به‌صورت وجه تخصیص‌نیافته ثبت و `receiptNumber` رسمی فقط سمت سرور صادر می‌شود (`provisionalReceiptId` جدا). Allocation عملیات مستقل است.
  - **Debit/Credit:** `Charge.entrySide` (DEBIT پیش‌فرض)، مدل مستقل `Credit` و `AbsenceCredit` (یک سطر به‌ازای هر ماه، کلید یکتای absence+دوره) اضافه شد؛ `TemporaryAbsence.creditChargeId` در قرارداد با `credits[]` جایگزین شد.
  - **Deposit:** مدل مستقل `DepositApplication` + درخواست و endpointهای جداگانهٔ `refund`/`forfeit`؛ `depositCreate` فقط دریافت؛ پاسخ `/deposits/apply` به `DepositApplication` تغییر کرد.
  - **Billing:** `BillingRunRequest` به `BillingPreviewRequest`/`BillingPostRequest` تفکیک شد؛ `dryRun` حذف؛ `businessKey` و `dueDayOfMonth` اضافه شد؛ `periodEnd` نیمه‌باز صریح شد.
  - **مبلغ:** `Money` مثبت (`minimum: 1`) و `NonNegativeMoney` (صفرپذیر) جدا شد؛ مبالغ حساب/گزارش به `Amount` (رشته، تا ۱۹ رقم) یکسان شد.
  - **چرخهٔ Void/Refund پرداخت:** `paymentReverse` اکنون Void اتمیک را صریح می‌کند (آزادسازی `AllocationRelease`های append-only با سقف «مجموع Release ≤ مبلغ تخصیص»، سپس Reversal با جهت مخالف؛ Refund نقدی جدا). سقف مجموع Release و محدودیت Refund به ماندهٔ تخصیص‌نیافته در `AllocationRelease`/`PaymentRefund` مستند شد.
  - **DepositApplication/DepositType/Credit:** `DepositApplicationRequest` اکنون `depositTransactionId` اجباری دارد (ودیعهٔ مشخص مصرف‌شونده)؛ `DepositType` فاقد `APPLIED_TO_CHARGES` شد؛ مدل مستقل `Credit` حذف و `Charge.entrySide=CREDIT` تنها مدل canonical اعتبار شد؛ `info.version` → `0.5.0`.
  - **مجوزها (403):** endpointهای اصلاحیِ `chargeReverse`، `depositReverse`، `expenseReverse`، `allocationRelease` 403 گرفتند (علاوه بر پرداخت/ودیعه/apply/billing قبلی).
  - **پاسخ Void:** `PaymentVoidResult` (`payment` + `releases[]` + `reversal`) ساخته و پاسخ `paymentReverse` به آن تغییر کرد؛ تعامل Refund↔Void (ممنوعیت Void کامل تا تعیین‌تکلیف Refund) صریح شد.
  - **اسناد مدل پول:** `api-conventions.md`، `assumptions-register` (A-006)، `glossary-fa-AF`، `requirements` (REQ-NF-001)، `contract-changes.md` و `architecture-overview.md` با A-016 (عدد صحیح افغانی) تطبیق شدند؛ وضعیت D-01..D-18 در پلان «قطعی» و `offline-sync.md` «قرارداد هدف نه اجراشده» شد.
  - **این دوره (ممیزی سوم):** `DepositApplicationResult` (پاسخ گروهی: `applications[]` + `totalApplied` + `remainingDepositBalance`) و endpoint `POST /absences/{id}/credits` (`AbsenceCreditResult`) افزوده شد؛ تناقض ReceiptCounter در پلان رفع شد (سطح Organization، بدون reset سالانه)؛ A-001 و Q-001/Q-004/Q-012 با A-015/Refund-Void/عدم Backdate حل شدند؛ gap-analysis «گزارش تاریخی» شد؛ Permission Matrix (cross-tenant/403-404)، Idempotency Replay و Offline/Backup و `X-Expected-Version` مستند/یکپارچه شدند.
  - **ممیزی چهارم (P0):** `actualReturnDate` به `TemporaryAbsenceRequest` افزوده و trigger یکتای AbsenceCredit (PATCH=ثبت بازگشت→RETURNED، POST=تولید Credit→CLOSED) شد؛ `AbsenceStatus` شامل RETURNED/CLOSED؛ date semantics (endDate exclusive + `lastOccupiedDateInclusive`) صریح شد؛ `PENDING_SYNC` از مدل سرور حذف (فقط ISSUED)؛ Idempotency-Key به contract lifecycle/checkout/end/archive/absence/package/org-patch افزوده و `X-Expected-Version` یکدست شد؛ `PLATFORM_ADMIN` جدا تعریف شد؛ Q-009 و absence-policy و پلان (D-01/Credit) هماهنگ شدند.
  - **ممیزی پنجم (P0):** جداسازی `TemporaryAbsenceCreateRequest`/`TemporaryAbsenceUpdateRequest`؛ `absenceUpdate` → `X-Expected-Version` اجباری؛ قانون Transfer از `ContractRequest` خارج و به endpoint `assignmentTransfer` منتقل شد؛ ردیف AbsenceCredit در ماتریس → OWNER/ADMIN؛ `chargeCreate` → description + 403 بر پایهٔ `entrySide`؛ Idempotency-Key به ۵ Update (hostel/room/bed/resident/contract)؛ `idempotency.md` → retention دائمی «طرح هدف آینده» + authorization قبل از replay؛ absence-policy 3.4/3.5 قطعی شد.
  - **ممیزی ششم (P0):** Idempotency کامل شد (۵۶/۶۲ mutation + ۶ استثنای مستند Auth/Preview)؛ 403 به ۲۴ عملیات master-data و ۱۰ عملیات `/admin/**` افزوده شد؛ ماتریس به path+method و منبع authority `PLATFORM_ADMIN = User.isPlatformAdmin` قطعی شد؛ canonical hash → SHA-256 با قواعد serialization.
  - **ممیزی هفتم (P0/P1):** استثناهای Idempotency به ۶ مورد دقیق (`authLogin`/`authRefresh`/`authLogout`/`authLogoutAll`/`authChangePassword` + `billingRunPreview`) اصلاح شد؛ `authRegister` از استثناها خارج و هدر آن اجباری ماند؛ ۶ مسیر ماتریس اصلاح و ۱۰ مسیر `/admin/**` کامل شد؛ 403 به `allocationCreate`/`expenseCreate`/`absenceCreate`/`absenceUpdate` افزوده شد؛ canonical hash با ساختار JSON قطعی (SHA-256 hex) و مثال تستی ثبت شد.
  - **ممیزی هشتم (P0/P1):** هم‌ترازی security ماتریس با OpenAPI — طبقه‌بندی ۵کلاسه (Anonymous/احراز بدون نقش/عضو سازمانی/محدود نقش/Platform Admin)؛ ۶ اصلاح security قرارداد (`invitationAccept`→`security: []`؛ `systemMe`/`authMe`/`logout`/`logout-all`/`change-password`→`[{ bearerAuth: [] }]`)؛ canonical hash دقیق با RFC 8785/JCS + I-JSON + ۵ test vector با SHA-256 واقعی.
  - **ممیزی نهم (P0/P1):** `GET /organizations` → `[{ bearerAuth: [] }]` (فهرست عضویت‌ها برای انتخاب سازمان، بدون `X-Organization-Id`)؛ ۱۰ مسیر `/admin/**` → `[{ bearerAuth: [] }]` بدون `X-Organization-Id` (نقش قطعی از `User.isPlatformAdmin`)؛ ادعای عددی RFC 8785 تصحیح (ECMAScript `Number::toString` + safe-integer؛ عدد بزرگ با JSON string)؛ `semanticHeaders`/`X-Expected-Version` به fingerprint اضافه و ۶ test vector جدید (T6 = نسخهٔ متفاوت → hash متفاوت) با SHA-256 واقعی؛ قواعد query قطعی (`?k`≡`?k=`≡`[""]`، percent-decode یک‌بار، `+` literal، scalar تکراری رد 422).
  - **ممیزی دهم (مستندات وضعیت، بدون تغییر کد):** سه test vector ناقص (T3b/T4b/T6b) با JSON کامل جایگزین شد؛ «قرارداد هدف vs رفتار فعلی کد» در `idempotency.md` و `permissions-matrix.md` صریح ثبت شد.
  - **وضعیت Gate 1 — ✅ قفل رسمی (2026-11-07):** مجوز صریح مالک پروژه صادر شد؛ از این لحظه قرارداد OpenAPI مالی (Gate 1 — Contract Lock) قفل است. CI سبز روی PR #1 با سه run (`42273554895`، `42339956241`، `42341231268`؛ همهٔ مراحل Build/OpenAPI/Prisma/Unit/Migrate/E2E موفق). PR #1 باز و `main` دست‌نخورده؛ Merge تا دستور جداگانه ممنوع. شروع M-1 و M-2 با مجوز رسمی (ترتیب: M-1 ابتدا؛ preflight فقط‌خواندنی M-2 هم‌زمان؛ Migration M-2 پس از تثبیت M-1).
  - **پردهنشده (فقط بعد از قفل) — گپ پیاده‌سازی شناخته‌شده:**
    - `GET /api/v1/organizations` در OpenAPI هست ولی هنوز در `OrganizationsController` پیاده نشده؛ Controller فعلی class-level `TenantGuard` دارد، پس route آینده نباید به guard وابستهٔ tenant متکی باشد؛ فقط Bearer لازم دارد و باید پیش از انتخاب organization اجرا شود.
    - Idempotency: `IdempotencyService` فعلی هنوز `stableStringify(payload)` دارد و method/route/path/query/semanticHeaders را نمی‌پوشاند؛ `authRegister` هدر را اعتبارسنجی می‌کند ولی به `AuthService.register` منتقل نمی‌کند (بازیابی فعلی email/password)؛ idempotency ثبت‌نام باید جداگانه طراحی/تست شود (ثبت‌نام پیش از organization و scope فعلی organization-based است).
    - امنیت 404/403: سیاست هدف = عدم عضویت → 404 و نقش ناکافی → 403؛ رفتار فعلی کد = `TenantGuard` → 403 و `PlatformAdminGuard` → 403 (هم‌ترازی، کار مرحلهٔ پیاده‌سازی).
- **بعدی (فعال):** M-1 (Date + Amount + Contract Checkout/Terminate) ابتدا پیاده‌سازی و اعتبارسنجی می‌شود؛ هم‌زمان inventory و preflight فقط‌خواندنی M-2 آماده می‌شود. Migration/اجرای M-2 پس از تثبیت M-1. M-3 و Charge/Payment/Allocation services و Controllerهای مالی در این مرحله مجاز نیستند.
## M-1 — Integration Harness (PostgreSQL واقعی) — 2026-11-07
- **`scripts/test-m1-migration.cjs` (۳۴ چک، همه PASS محلی):**
  - اعمال migrationهای 1..8 سپس M-1 روی دیتابیس موقتی `eskan_m1_*` (هر سناریو DB جدا می‌سازد و حذف می‌کند؛ هیچ DB پایدار/واقعی دست نمی‌خورد).
  - حفظ `end_reason = NULL` برای ردیف‌های legacy (بدون بازنویسی تاریخچه).
  - موفقیت migration روی baseline معتبرِ غیرخالی (org/hostel/room/bed/resident/contract + charges/payments/expenses/deposit/manual_payment مثبت).
  - شکست preflight و اثبات rollback کامل DDL: پس از خطا، enum `AssignmentEndReason`، ستون `end_reason` و هیچ‌یک از ۸ constraint جدید ساخته نمی‌شوند و داده‌های نامعتبر دست‌نخورده می‌مانند (خطای actionable با `contracts=N charges=N`).
  - طرد مقادیر صفر/منفی و سرریز int32 مستقیماً توسط CHECKهای PostgreSQL (۲۳۵۱۴ / ۲۲۰۰۳)؛ `deposit=0` مجاز.
- **`test/integration/m1-concurrency.integration-spec.ts` (۳ تست، همه PASS) + `test/jest-integration.json`:**
  - checkout هم‌زمان دوگانه با کلید متفاوت → فقط یک transition واقعی (`version=2`) و هر دو خروجی CLOSED.
  - checkout هم‌زمان با کلید مشترک → replay ایدمپوتنت (یک `idempotency_records`) و تک‌transition.
  - race میان checkout و transfer روی PostgreSQL واقعی با Prisma/Service واقعی (بدون mock): هر ترتیبی که برنده شود، قرارداد CLOSED و هیچ assignment فعال/legacy-NULL باقی نمی‌ماند؛ تاریخ‌ها/`endReason` درست.
- **سیاست Idempotency:** فعلی `IDEMPOTENCY_RETENTION_DAYS = 30` (انقضای ۳۰روزه، نه دائمی). سازگاری آن با Offline Outbox قابل صف باید جداگانه تصمیم شود.
- npm scripts جدید: `test:integration` و `test:migration`؛ هر دو به CI اضافه شدند.
## M-1 — ACCEPTED + نکات harness — 2026-11-07
- **M-1 رسماً پذیرفته شد** (حکم مالک). Integration Harness (migration/constraint ۳۴→۴۰ چک + concurrency ۳ تست) روی PostgreSQL واقعی در CI سبز است.
- سه نکتهٔ harness در فهرست بهبود ثبت شد:
  1. **race فقط یک‌بار و بدون تحمیل قطعی هر دو ترتیب قفل** — بهبود آینده: هر دو ترتیب با کنترل زمان‌بندی/barrier.
  2. **rollback باید نبودن همهٔ ۸ constraint را صریح بررسی کند** — اکنون اصلاح شد (`test-m1-migration.cjs` در سناریوی preflight همهٔ ۸ constraint را جداگانه بررسی می‌کند؛ مجموع **۴۰/۴۰**).
  3. **guard ایمنی fail-closed برای اسکریپت‌های ایجاد/حذف DB** — اضافه شد: `assertLocalTestHost()` در `test-m1-migration.cjs` و `m1-concurrency.integration-spec.ts` (فقط host محلی؛ override: `ESKAN_TEST_DB_ALLOW=1`).
- سیاست `IDEMPOTENCY_RETENTION_DAYS=30` همچنان تصمیم باز است (نه دائمی)؛ پیش از Outbox آفلاین باید تکلیف retention بلندمدت مشخص شود.

## M-2 — Read-only Preflight (تشخیصی) — 2026-11-07
- وضعیت: **M-2 در فاز پیش‌بررسی خواندنی**؛ فقط SELECT، فقط روی clone/دیتابیس آزمایشی throwaway.
- ابزار: `scripts/preflight-m2.cjs` (guard fail-closed + `BEGIN TRANSACTION READ ONLY`).
- گزارش کامل: `docs/project/m2-preflight-report.md`.
- نتیجهٔ کلیدی (demo مصنوعی — نه دیتابیس واقعی): cross-org=۸، cross-resident=۳ (شامل TemporaryAbsence)، orphan=۰ (FK-enforced)، و **۱۱/۱۱ کلید UNIQUE موردنیاز** (۲ و ۳ ستونه) غایب‌اند.
- تکمیل پوشش پس از بازبینی مالک: رابطهٔ **Absence→Charge (creditChargeId)** در هر سه جهت (org / resident / orphan)؛ کلیدهای سه‌ستونی `(organization_id, resident_id, id)` روی stay_contracts/charges/payments/temporary_absences (و حذف کلید دوستونی غیرلازمِ temporary_absences)؛ تشخیص دقیق UNIQUE با تطبیق مجموعه/ترتیب ستون‌ها + حذف index ناvalid/ناready (`indisvalid`/`indisready`).
- CI سه مرحلهٔ M-2: (۱) `preflight-m2.cjs --strict` baseline پاک، (۲) `test-m2-preflight-detection.cjs` (کارش cross-tenant incl. creditCharge و اثبات تشخیص با exit 1)، (۳) `preflight guard fail-closed` روی نام دیتابیس غیرآزمایشی (exit 2).
- guard = دفاع در عمق (host محلی + نام دیتابیس dev/test allowlist)؛ **مانع قطعی Port-Forwarding نیست** — مقاومت واقعی با نقش کم‌امتیاز بدون CREATEDB یا سرور آزمایشی مستقل است.
- **قبل از هر migration باید همین ابزار روی clone واقعی دیتابیس مبنای توسعه اجرا شود** (اعداد demo، وضعیت واقعی نیستند).
- هیچ DDL/DML/migration/backfill، FK/index، تغییر PaymentAllocation/LockService، کد production یا OpenAPI انجام نشد. M-3 و سرویس‌های مالی مجاز نیستند. قبل از هر migration/schema تغییر، مجوز جداگانه لازم است.
## M-2 — Preflight روی Clone واقعی — 2026-11-07
- Clone: `eskan_preflight_clone_20261107` از `eskan_dev` (محلی، `CREATE DATABASE ... TEMPLATE eskan_dev`)، ساخته‌شده در `2026-11-07T16:34:38Z`.
- نتیجه (فقط `node scripts/preflight-m2.cjs --strict`): **cross_org=0، cross_resident=0، cross_hostel=0، orphan=0**؛ کلیدهای composite همچنان ۱۲/۱۲ MISSING (وضعیت schema، نه خطای داده).
- دادهٔ منبع: org=72, residents=84, stay_contracts=90, bed_assignments=72، accommodation_packages=19 (57 components)، contracts_with_package=7؛ جدول‌های مالی و temporary_absences خالی (۰).
- تفسیر: دادهٔ موجودِ لایهٔ اقامت پاک است → migration بدون backfill ممکن؛ مسیر مالی/absence چون خالی است باید بعد از ورود دادهٔ واقعی دوباره preflight شود.
- جزئیات: `docs/project/m2-preflight-clone-report.md`.
- آزمون destructive روی clone اجرا نشد (طبق دستور).
- پوشش Package اضافه شد: package→hostel (org)، contract→package (org)، contract.hostel vs package.hostel و orphanها؛ روی clone همه ۰ (۱۹ package و ۷ contract←package پاک).
## M-2 — پیاده‌سازی مرحلهٔ اول + Rehearsal — 2026-11-07
- **مجوز:** پیاده‌سازی و Rehearsal روی دیتابیس‌های ایزوله؛ بدون تغییر `eskan_dev`/Staging/Production و بدون Merge.
- **Schema:** ۱۲ کلید UNIQUE tenant/resident-scoped + `PaymentAllocation.organization_id/resident_id` + رابطه‌های composite.
- **Migration:** `20261107120000_m2_tenant_resident_composite_integrity` — preflight قبل از DDL، ۱۲ کلید UNIQUE، backfill + swap PaymentAllocation، ۱۷ composite FK، ۲ تریگر Package/Hostel. BEGIN/COMMIT تراکنشی.
- **LockService:** `lockForUpdate(tx, entity, id, organizationId)` اجباری + `lockGlobal` برای global؛ همهٔ Call Siteها اصلاح شدند.
- **تست‌ها:** `test-m2-migration.cjs` (۴۱/۴۱)، `lock.service.spec.ts` (۶ unit)، `lock-tenant-isolation.integration-spec.ts` (۳ integration)، به‌روزرسانی `test-m1-migration.cjs`/`test-m2-preflight-detection.cjs` و اصلاح `preflight-m2.cjs`.
- **Rehearsal روی Clone:** از `eskan_preflight_clone_20261107` (دست‌نخورده) یک Clone جدید ساخته و M-2 اعمال شد؛ preflight بعدی `cross_org=0 / cross_resident=0 / cross_hostel=0 / orphan=0` و **۱۲/۱۲ PRESENT**. Clone اصلی دست‌نخورده ماند.
- **تست منفی واقعی:** cross-org/cross-resident → `23503`؛ Package/Hostel → `23514` (تریگر). Rollback با preflight-fail بدون leftover schema.
- جزئیات: `docs/project/m2-rehearsal-report.md`.
- **ممنوع مانده:** اعمال روی `eskan_dev`/Staging/Production، Merge PR، شروع M-3 و سرویس‌های مالی.
## M-2 Remediation — بازبینی مهندسی نهایی — 2026-11-08
پس از بازبینی مستقل مالک، سه نقص اصلی (Parity، Trigger concurrency، Child index) + دو مورد تکمیلی (PaymentAllocation unique، onDelete) برطرف شد:

### ۱. Prisma Schema / Database parity (نقص ۱)
- **همهٔ ۱۹ composite FK اکنون در Prisma Schema مدل شده‌اند** (روابط composite). روابط nullable با دو رابطه مدل شدند: رابطهٔ optional با `onDelete: SetNull` (FK تک‌ستونهٔ SET NULL) + یک رابطهٔ named tenant با `onDelete: NoAction` (FK مرکب scope) — دقیقاً همان چیزی که `prisma migrate diff` تولید می‌کند.
- FKهای تک‌ستونهٔ روابط NOT‌NULL حذف و با composite جایگزین شدند؛ نام قیدها و `ON UPDATE CASCADE` کاملاً با خروجی Prisma هم‌خوان است.
- **تست تکرارپذیر:** `scripts/test-m2-prisma-parity.cjs` — یک دیتابیس throwaway را migrate می‌کند و `prisma migrate diff` اجرا می‌کند؛ خروجی باید **خالی** باشد (اثبات می‌کند Migration بعدی Prisma هیچ composite FK/کلید/indexی را حذف نمی‌کند). خروجی: **empty migration → 5/5 PASS**.

### ۲. Trigger concurrency (نقص ۲)
- `enforce_stay_contract_package_hostel` اکنون package را با `SELECT ... FOR UPDATE` می‌خواند تا insert/update قرارداد با تغییر `hostel_id` بسته روی همان ردیف serialize شود.
- **تست هم‌زمانی واقعی (۲ اتصال):** `scripts/test-m2-package-hostel-concurrency.cjs` — دو ترتیب A (Update Package ← Insert Contract) و B (Insert Contract ← Update Package)؛ در هر دو یک عملیات block شده و با `23514` رد می‌شود و invariant حفظ می‌ماند. **4/4 PASS**.
- **تست مستقل تریگر دوم** در `test-m2-migration.cjs`: تغییر hostel به مقدار ناسازگار → `23514`؛ تغییر به NULL (جهانی) → مجاز.

### ۳. Child-side FK indexes (نقص ۳)
- ۱۰ index فرزند برای composite FKها ساخته شد (rooms, beds, stay_contracts.package, bed_assignments, charges, expenses, temporary_absences×۲, payment_allocations×۲). names با Prisma هم‌خوان است.

### ۴. onDelete tests (تکمیلی ب)
- `test-m2-migration.cjs` حالا رفتار واقعی DELETE را می‌آزماید: SET NULL (package/expense.hostel/charge.contract/absence.creditCharge)، CASCADE (payment→allocation)، RESTRICT (resident و hostel دارای فرزند NOT NULL). **92/92 PASS**.

### ۵. PaymentAllocation unique (تکمیلی الف)
- `@@unique([paymentId, chargeId])` حذف شد (مطابق phase-9-engineering-plan.md F-19)؛ از migration هم حذف شد (پیش‌نیاز AllocationRelease در M-3b). این قید دیگر به فاز مالی منتقل نمی‌شود.

### وضعیت نهایی
- `test-m2-migration.cjs`: **92/92**؛ `test-m2-package-hostel-concurrency.cjs`: **4/4**؛ `test-m2-prisma-parity.cjs`: **5/5**.
- `prisma validate` سبز؛ `npm run build` سبز؛ `prisma migrate diff` خالی (parity کامل).
- هیچ تغییری روی `eskan_dev`/Staging/Production و Clone اصلی انجام نشد. Merge/شروع M-3 هنوز ممنوع.
## 4c — چرخه‌حیات Lifecycle + Idempotency + Retention CHECK — 2026-11-08

تصمیم 4c (`X-Expected-Version` + `Idempotency-Key` روی پنج عملیات Lifecycle + Retention دائمی) پیاده‌سازی و سخت‌سازی نهایی شد. این بخش وضعیت واقعی Migration و نتیجهٔ نهایی را ثبت می‌کند. (بند «هیچ تغییری روی eskan_dev انجام نشد» در بخش M-2 مربوط به وضعیت همان زمان بود؛ وضعیت فعلی در همین‌جاست.)

### وضعیت Migration روی محیط‌ها
| Migration | `eskan_dev` | CI / DB آزمایشی | Staging / Production |
|---|---|---|---|
| M-1 | اعمال شد (Backup + Rehearsal) | تست شد | اعمال نشد |
| M-2 | اعمال شد (Backup + Rehearsal) | تست شد | اعمال نشد |
| 4c — `20261108180000_idempotency_retention_class` | **اعمال نشد** | تست شد (CI) | اعمال نشد |
| 4c — `20261108190000_idempotency_retention_consistency_check` | **اعمال نشد** | تست شد (CI) | اعمال نشد |

- پیش از M-1/M-2، Backup معتبر تهیه و Rehearsal انجام شد؛ Preflight موفق بود و رکوردها حفظ شدند.
- هیچ Migration 4c روی `eskan_dev`/Staging/Production اعمال نشده است.

### نتیجهٔ نهایی 4c
- Commit: `6bffa1b` → `c4d17ab` → `d84b453`؛ CI نهایی `42502182823` — موفق (همهٔ گام‌ها). (اجرای `42499710094` نتیجهٔ تاریخی مرحلهٔ سخت‌سازی روی `c4d17ab` با CHECK 10/10 بود.)
- Unit: 56/56؛ Integration: **26/26** (شامل ۱۸ تست `test/integration/lifecycle-versioning.integration-spec.ts` برای activate/terminate/end/transfer: نسخهٔ صحیح، Replay، نسخهٔ قدیمی → `409 RESOURCE_VERSION_CONFLICT`، بازاستفادهٔ کلید/نسخه/payload → `409 IDEMPOTENCY_KEY_REUSED`).
- Retention CHECK: **11/11** (`scripts/test-idempotency-retention-check.cjs`: وجود constraint از `pg_constraint` + نقض `23514` برای هر ۴ حالت در INSERT و UPDATE، شامل تست مثبت UPDATE برای TRANSIENT).
- M-2 parity: 5/5 (`prisma migrate diff` خالی).
- ۱۸ نظر Sourcery: ۳ Resolved (با شواهد)، ۱۵ Open. موارد Auth/Organization (از جمله «Revoked Platform Admin retain access») خارج از M-3 و در مسیر مستقل پیگیری می‌شوند.
- JCS/RFC 8785 هنوز پیاده‌نشده؛ تست اختصاصی Authorization قبل از Replay باقی مانده است.

### وضعیت Merge
- PR #1 باز است و **Merge نشده**؛ M-3 شروع نشده است.
## Post-Merge Checkpoint — 2026-11-08

- **PR #1 با موفقیت ادغام شد.**
- Merge commit: `1edcb437191d9ee84834a5bcfae1971f38ea0a4e`؛ والد ادغام شامل `a84d4ee` است؛ `main` اکنون روی همین merge commit قرار دارد.
- Post-merge CI `42507580953` روی همان merge SHA — **موفق**.
- نتایج تست: Unit 56/56؛ Integration 26/26؛ Retention CHECK 11/11؛ M-1 40/40؛ M-2 92/92؛ M-2 concurrency 6/6؛ M-2 parity 5/5.
- OpenAPI validation موفق بود (با ۶ هشدار از پیش موجود).
- M-3 سرویس‌های مالی **شروع نشده** است.
- هر دو Migration 4c (`20261108180000_idempotency_retention_class` و `20261108190000_idempotency_retention_consistency_check`) در زمان این checkpoint همچنان روی `eskan_dev` اعمال‌نشده بودند؛ **اعمال واقعی روی `eskan_dev` در checkpoint بعدی («اعمال 4c روی eskan_dev») ثبت شده است.** Staging/Production همچنان اعمال‌نشده‌اند.
- ⚠️ بند «PR #1 باز است و Merge نشده» در بخش 4c بالاتر، وضعیت همان مقطع تاریخی را ثبت کرده و پس از این ادغام دیگر معتبر نیست.

## اعمال 4c روی `eskan_dev` — 2026-11-08

- **دو Migration 4c با موفقیت روی `eskan_dev` اعمال شدند** (با `npx prisma migrate deploy`؛ نه `migrate dev`):
  - `20261108180000_idempotency_retention_class`
  - `20261108190000_idempotency_retention_consistency_check`
- وضعیت Migration: **۱۲/۱۲**؛ `prisma migrate status` → «Database schema is up to date!».
- **Backup پیش‌از-Migration (تازه، نقطهٔ بازیابی):**
  - مسیر: `backups\eskan_dev_pre_migrate_2026-11-08-18-50-59.dump`
  - اندازه: `254,777 bytes`
  - SHA256: `04b854c30a0acf63b84cfb43ea83c2309a89b5cb4d00c6fca6a1a03c21c4c599`
- **حفظ داده:** `idempotency_records` → **۴۲۷** رکورد حفظ شد؛ **۰** رکورد ناسازگار (consistency CHECK).
- **ستون‌ها:** `retention_class` (NOT NULL) اضافه شد؛ `expires_at` اکنون nullable.
- **CHECK constraint:** `idempotency_records_retention_consistency_check` حاضر است.
- رکوردهای قدیمی همچنان `TRANSIENT` و دارای `expires_at` غیر NULL (بدون backfill حدسی).
- **M3 (سرویس‌های مالی) در زمان این checkpoint شروع نشده بود.**
- **Staging و Production دست‌نخورده باقی مانده‌اند.**
- **قرارداد OpenAPI:** نسخهٔ فعلی **`0.5.0`**.


## M3a — Charge / Billing / Credit Engine — 2026-11-08

### وضعیت
- **M3a (Charge / Billing / Credit) پیاده‌سازی و تست شد** (شاخهٔ `feat/phase-9-m3a-charge-credit` از `417092d`).
- Migration افزودنی `20261108220000_m3a_charge_billing_credit` (سیزدهمین) اعمال و تست شد.

### دامنهٔ اجراشده
- **Charge Engine:** ثبت Charge مثبت AFN (int، سقف int32)، `entrySide` DEBIT/CREDIT، `RENT` الزاماً `contractId`، business key یکتای کرایه (`organization + contract + RENT + period`) به‌صورت partial unique index، posted سند تغییرناپذیر.
- **Billing Preview/Post:** Preview بدون side effect؛ Post صدور idempotent با `Idempotency-Key` دائمی + business key `(organization, periodStart, periodEnd)`؛ snapshot اجزای Package؛ بازهٔ نیمه‌باز `[periodStart, periodEnd)`؛ `dueDayOfMonth` (پیش‌فرض `hostel.rentDueDayOfMonth`).
- **Proration:** فرمول `amount × occupiedDays / calendarDays` با `decimal.js` و گردکردن `HALF_UP`، محاسبهٔ جداگانهٔ هر Component، ماه‌های ۲۸/۲۹/۳۰/۳۱.
- **Credit / Absence:** مدل canonical `Charge.entrySide=CREDIT` (بدون مدل مستقل Credit)؛ دلیل + actor؛ نقش OWNER/ADMIN برای ثبت Credit؛ تولید Credit غیابت پس از بازگشت تأییدشده، آستانهٔ `hostel.absenceMinDays` (پیش‌فرض ۳)، عدم کسر Accommodation، فقط `deductibleOnAbsence=true`، `[actualDepartureDate, actualReturnDate)` (روز بازگشت محاسبه نمی‌شود)، تقسیم چندماهه به دوره‌های تقویمی، `absence_credits` با کلید `(organization, absence, period)`.
- **Idempotency/JCS:** fingerprint شش‌فیلدی (`method/route/pathParams/query/semanticHeaders/body`) با JCS (RFC 8785) و SHA-256 (`src/common/idempotency/jcs.ts`)؛ عملیات مالی `retentionClass=PERMANENT`.
- **Audit/Sync اتمیک:** هر Posting (Charge/BillingRun/AbsenceCredit) در یک transaction با `AuditEvent` + `SyncChange` ثبت می‌شود (`src/common/finance/posting.service.ts`؛ cursor سازمانی monotone).

### تست‌ها
- Unit: **۷۱/۷۱** (شامل ۶ JCS + ۶ proration جدید).
- Migration M3a: **۱۱/۱۱** (`scripts/test-m3a-migration.cjs` — parity خالی، partial index، CHECKها، business key).
- Integration: **۱۸/۱۸** (`test/integration/m3a-charges-billing.integration-spec.ts`) + Concurrency: **۲/۲** (`test/integration/m3a-concurrency.integration-spec.ts` — race با barrier واقعی PostgreSQL).
- Composite FKهای tenant از ۱۹ به **۲۲** افزایش یافت (تست parity به‌روزرسانی شد).

### خارج از محدودهٔ M3a (Backlog)
- **M3b** (Payment/Receipt/Allocation)، **M3c** (Deposit/Refund/Void/Expense)، **M3d** (Statement/Account/Pull Sync/Tombstone/Audit read API).
- **AUTH-ORG-PLATFORM-ADMIN** (بازبینی `PlatformAdminGuard`، `GET /organizations`، invitation token flow، `/admin/**`، idempotency ثبت‌نام، 404/403).
- Branch protection، ۱۵ Sourcery باز، هشدارهای OpenAPI، بازنویسی کل Idempotency برای همهٔ endpointها، Flutter/UI، استقرار Production.

### جزئیات محیطی (بدون افشای secret)
- Migrationهای M3a روی **دیتابیس توسعهٔ محلی `eskan_dev` هنوز اعمال نشده‌اند** (تست روی DBهای throwaway انجام شد)؛ Staging/Production دست‌نخورده.
