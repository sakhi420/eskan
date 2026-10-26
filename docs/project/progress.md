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
| 5   | دیتابیس و migration | ⏳ در انتظار | prisma schema |
| 6   | احراز هویت و tenancy | ⏳ در انتظار | auth, refresh, BOLA |
| 7   | سازمان/لیلیه/اتاق/بستر | ⏳ در انتظار | CRUD, archive |
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

### Next actions
- فاز 5 (دیتابیس کامل + migration)، سپس فاز 6 (احراز هویت و tenancy).