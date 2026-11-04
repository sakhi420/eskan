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
| 8   | ساکن/قرارداد/تخصیص | ⏳ در انتظار | overlap, concurrency |
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

- فاز 8: ساکن/قرارداد/تخصیص بستر (overlap و concurrency) طبق قرارداد.