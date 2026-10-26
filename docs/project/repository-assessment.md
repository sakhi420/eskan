# ارزیابی مخزن و خط پایه — ESKAN Backend

**تاریخ:** 2026-10-25
**فاز:** 0 — بررسی مخزن و خط پایه
**وضعیت اجرا:** واقعی (با شواهد فرمان اجرا شده)

## 1. خلاصه

مخزن کاری `f:\flutter-project\ESKAN` عملاً خالی است و فقط فایل مسترپرامپت
`ESKAN_BACKEND_MASTER_PROMPT_NESTJS_FA_v2.md` را دارد. هیچ کد بک‌اند،
پکیج، migration یا تستی هنوز ساخته نشده است. مخزن هنوز یک مخزن Git نیست
(فایل `.git` وجود ندارد). بنابراین پروژه باید از صفر اسکلت‌بندی شود.

## 2. وضعیت پوشه و فایل‌ها

فهرست واقعی پوشه (خروجی `Get-ChildItem -Force`):

| Mode    | Length | Name                                       |
|---------|--------|--------------------------------------------|
| -a----  | 95522  | ESKAN_BACKEND_MASTER_PROMPT_NESTJS_FA_v2.md |

هیچ فایل/پوشه دیگری وجود ندارد (بدون `node_modules`، بدون `src`، بدون `prisma`).

## 3. وضعیت Git

خروجی واقعی `git rev-parse --is-inside-work-tree`:

```
fatal: not a git repository (or any of the parent directories): .git
```

نتیجه: مخزن Git هنوز initialize نشده است. branch، commit اخیر و `git status`
برای این پوشه قابل اعمال نیست. (در فاز 4 با `git init` مخزن ساخته می‌شود.)

## 4. نسخه‌های ابزار (ثبت‌شده با فرمان واقعی)

| ابزار           | نسخهٔ واقعی       | فرمان                     | نتیجه |
|-----------------|-------------------|---------------------------|-------|
| Node.js         | v24.21.0          | `node --version`          | PASS  |
| npm             | 11.19.0           | `npm --version`           | PASS  |
| git             | 2.52.0.windows.1  | `git --version`           | PASS  |
| NestJS CLI      | 12.0.8 (global)   | `nest --version`          | PASS  |
| PostgreSQL      | 17.6              | `psql --version`          | PASS  |
| Docker          | —                 | `docker --version`        | FAIL (install نشده) |
| Docker Compose  | —                 | `docker compose version`  | FAIL (install نشده) |
| psql (PATH)     | —                 | `where psql`              | FAIL (در PATH نیست؛ باینری موجود) |

نکته: `psql.exe` و سایر ابزارهای PostgreSQL در
`C:\Program Files\PostgreSQL\17\bin\` موجودند ولی در `PATH` سیستم نیستند.
برای اجرا باید مسیر به `$env:Path` افزوده شود یا مسیر کامل استفاده گردد.

## 5. بررسی اتصال PostgreSQL

خروجی واقعی `pg_isready -h localhost -p 5432`:

```
localhost:5432 - accepting connections
```

اتصال واقعی با `psql -w -U postgres` (بدون رمز) با موفقیت انجام شد:

```
current_user | version
postgres     | PostgreSQL 17.6 on x86_64-windows, compiled by msvc-19.44.35213, 64-bit
```

روش auth واقعی در `C:\Program Files\PostgreSQL\17\data\pg_hba.conf`:

```
local   all             all        trust
host    all             all        127.0.0.1/32  trust
host    all             all        ::1/128        trust
```

یعنی اتصال محلی از نوع `trust` است (بدون رمز). برای توسعه محلی می‌توان
بدون رمز متصل شد؛ برای محیط‌های دیگر باید credential مستند شود.

### ریسک مهم: دیتابیس‌های پروژهٔ دیگر

همین سرور PostgreSQL دیتابیس‌های زیر را دارد که متعلق به **پروژهٔ دیگری**
(نام تجاری `weshbazar`) هستند:

```
postgres, template0, template1, weshbazar, weshbazar_dev, weshbazar_shadow, weshbazar_test
```

و role ای به نام `weshbazar` وجود دارد. **این دیتابیس‌ها و role نباید لمس
شوند.** برای ESKAN دیتابیس و user مجزا با پیشوند `eskan` ساخته می‌شود
(مثلاً `eskan`, `eskan_dev`, `eskan_test` و role `eskan`).

## 6. دستورهای موجود build/test/lint/migration

هیچ فایل `package.json`، `tsconfig.json`، migration یا test وجود ندارد؛
بنابراین دستورهای build/test/lint/migration قابل اجرا نیستند و وضعیت آن‌ها
`NOT RUN` (به دلیل نبود پروژه) است. این وضعیت باید از «شکست» تمیز داده شود.

## 7. بررسی secrets و دادهٔ واقعی

- در Git چیزی track نشده است (مخزن Git وجود ندارد).
- هیچ فایل `.env`، `.env.*` یا credential در پوشه یافت نشد.
- در log ورودی هیچ secret واقعی مشاهده نشد.
- دیتابیس‌های پروژه‌ی دیگر (`weshbazar*`) موجودند؛ محتوای آن‌ها بررسی یا
  دستکاری نشده است و نباید بشود.

## 8. هدف مخزن

این مخزن برای ساخت **بک‌اند ESKAN** (NestJS + TypeScript + Prisma + PostgreSQL)
در نظر گرفته شده و از ابتدا خالی است. هیچ کد پروژهٔ دیگر نباید ادغام شود.

## 9. تصمیم ثبت‌شده برای خط پایه

1. در فاز 4 مخزن Git initialize و پروژهٔ NestJS از صفر ساخته می‌شود.
2. برای توسعهٔ محلی از PostgreSQL موجود و یک دیتابیس/role اختصاصی `eskan`
   استفاده می‌شود (چون Docker نصب نیست). فایل `docker-compose.yml` هم به عنوان
   گزینه برای محیط‌هایی که Docker دارند ارائه می‌شود ولی در این ماشین
   قابل اجرا نیست و این محدودیت شفاف ثبت می‌گردد.
3. دیتابیس‌های `weshbazar*` و role `weshbazar` دست‌نخورده می‌مانند.

## 10. جدول خط پایه (نتیجهٔ واقعی)

| فرمان/چک               | نتیجه                 | توضیح |
|------------------------|-----------------------|-------|
| `node --version`       | PASS (v24.21.0)       | نصب‌شده |
| `npm --version`        | PASS (11.19.0)        | نصب‌شده |
| `git --version`        | PASS (2.52.0)         | نصب‌شده |
| `nest --version`       | PASS (12.0.8)         | نصب‌شده |
| `psql --version`       | PASS (17.6)           | نصب‌شده |
| اتصال PostgreSQL       | PASS                  | trust/local، سرور running |
| `docker --version`     | FAIL                  | نصب نشده |
| `npm run build`        | NOT RUN               | پروژه/package.json ندارد |
| `npm test`             | NOT RUN               | تستی وجود ندارد |
| `npm run lint`         | NOT RUN               | پیکربندی lint ندارد |
| migration              | NOT RUN               | هیچ migration وجود ندارد |