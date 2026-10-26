# نمای کلی معماری — ESKAN Backend

## نوع معماری

Modular Monolith (NestJS) + Prisma + PostgreSQL. نه microservices.

## نمای runtime

```mermaid
flowchart LR
  subgraph Client
    APP[Flutter Android App]
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
  APP -->|HTTPS REST /api/v1| GW
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
| `charges`/`payments`/`deposits`/`expenses` | هستهٔ مالی با reversal |
| `reports` | گزارش‌های پایه |
| `audit` | ثبت audit برای عملیات حساس |
| `sync` | تغییرات pull بر اساس cursor |
| `common` | config/errors/filters/validation/tenancy/logging/security |

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
- پول از decimal.js و NUMERIC؛ هرگز Number.
- خطاها Problem Details با `code` پایدار و `traceId`.