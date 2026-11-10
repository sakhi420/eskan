# نمای کلی معماری — ESKAN Backend

## نوع معماری

Modular Monolith (NestJS) + Prisma + PostgreSQL. نه microservices.

## پلتفرم‌های هدف کلاینت

- پلتفرم‌های هدف اولیهٔ کلاینت ESKAN: **Android** و **Windows Desktop** (هر دو با Flutter/Dart).
- هر دو کلاینت از Backend مشترک NestJS + PostgreSQL و API مشترک (`/api/v1`) استفاده می‌کنند.
- تا حد امکان از یک **codebase مشترک Flutter** استفاده می‌شود؛ منطق کسب‌وکار، مدل‌ها،
  API client و منطق sync مشترک‌اند و فقط لایهٔ UI/UX به‌تناسب فرم‌فاکتور تنظیم می‌شود.
- UI متناسب با موبایل (لیست/فرم لمسی) و دسکتاپ (صفحه‌کلید، جدول، جست‌وجو، گزارش، چاپ رسید) طراحی می‌شود.
- ذخیره‌سازی آفلاین با **SQLite/Drift** و sync با Backend؛ سازگاری کتابخانه‌ها با هر دو
  پلتفرم هنگام آغاز توسعهٔ کلاینت بررسی و آزموده می‌شود.
- **iOS / macOS / Web** در حال حاضر جزو اهداف اولیه نیستند؛ ارزیابی در مراحل بعد.

## نمای runtime

```mermaid
flowchart LR
  subgraph Client["Flutter Clients (shared codebase)"]
    ANDROID[Android App]
    DESKTOP[Windows Desktop]
  end
  subgraph Backend["NestJS (Express)"]
    GW[Global pipes / filters / interceptors]
    AUTH[Auth Module]
    ORG[Organizations]
    HOST[Hostels/Rooms/Beds]
    RES[Residents/Contracts/Assignments]
    FIN[Charges/Payments/Deposits/Expenses]
    REP[Reports]
    SYNC[Sync]
    AUD[Audit]
  end
  subgraph DB
    PG[(PostgreSQL 17)]
  end
  ANDROID -->|HTTPS REST /api/v1| GW
  DESKTOP -->|HTTPS REST /api/v1| GW
  GW --> AUTH
  AUTH --> PG
  ORG --> PG
  HOST --> PG
  RES --> PG
  FIN --> PG
  REP --> PG
  SYNC --> PG
  AUD --> PG
```

## ماژول‌ها و مرزها

هر feature ماژول NestJS مستقل با ساختار `api`/`application`/`domain`/`infrastructure` است.

| ماژول | مسئولیت |
|-------|---------|
| `auth` | ثبت/ورود/refresh/logout، JWT access، refresh rotation، hashing |
| `organizations` | پروفایل سازمان و عضویت‌ها/نقش‌ها |
| `hostels`/`rooms`/`beds` | master data لیلیه و archive/deactivate |
| `residents` | ساکنان و جست‌وجو |
| `stay-contracts` | قرارداد اقامت و state machine |
| `assignments` | تخصیص بستر و جلوگیری از overlap |
| `charges` | هستهٔ مالی M3a (Charge، BillingRun، AbsenceCredit) — پیاده‌شده |
| `payments`/`deposits`/`expenses` | مالی M3b/M3c — فقط در قرارداد/Schema؛ ماژول اجرایی هنوز ساخته نشده |
| `reports` | گزارش‌های پایه |
| `audit` | ثبت audit برای عملیات حساس |
| `sync` | تغییرات pull بر اساس cursor |
| `common` | config/errors/filters/validation/tenancy/logging/security |

> **وضعیت اجرای ماژول‌ها (2026-11-10):** پیاده‌شده: `auth`، `organizations`، `hostels`/`rooms`/`beds`،
> `residents`، `contracts`، `assignments`، `packages`، `charges` (M3a). مالی بعدی
> (`payments`/`deposits`/`expenses`)، `reports`، `sync` و `audit` فعلاً در قرارداد/Schema تعریف شده‌اند
> ولی ماژول اجرایی ندارند.

## جریان درخواست (request pipeline)

```mermaid
sequenceDiagram
  participant C as Client
  participant M as Middleware (correlation id)
  participant G as Guards (auth + tenancy)
  participant P as ValidationPipe (DTO + forbidUnknown)
  participant S as Controller -> Service
  participant T as Prisma transaction
  participant D as PostgreSQL
  C->>M: request + Idempotency-Key (+Bearer)
  M->>G: user + active membership
  G->>P: validate + transform DTO
  P->>S: use-case
  S->>T: tx { entity + audit + sync change + idempotency }
  T->>D: commit/rollback
  S-->>C: Problem Details / envelope
```

## اصول

- tenant scope از security context؛ نه از body.
- تراکنش‌ها در serviceها (Prisma `$transaction`).
- پول عدد صحیح AFN (A-016)؛ گردکردن proration با decimal.js؛ هرگز Number/Float/Double.
- خطاها Problem Details با `code` پایدار و `traceId`.