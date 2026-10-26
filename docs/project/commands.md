# دستورهای پروژه و ثبت خروجی‌ها — ESKAN Backend

این فایل دستورهای واقعی اجراشده به همراه خروجی/نتیجه را ثبت می‌کند و در
فازهای بعد به‌عنوان مرجع دستورهای build/test/lint/migration به‌روز می‌شود.

## فاز 0 — دستورهای بررسی محیط (اجراشده)

محیط: Windows (PowerShell 5/7). مسیر کاری: `f:\flutter-project\ESKAN`.

```powershell
node --version
# v24.21.0

npm --version
# 11.19.0

git --version
# git version 2.52.0.windows.1

nest --version
# 12.0.8

$env:Path += ';C:\Program Files\PostgreSQL\17\bin'
psql --version
# psql (PostgreSQL) 17.6

pg_isready -h localhost -p 5432
# localhost:5432 - accepting connections

psql -w -U postgres -h localhost -p 5432 -d postgres -c 'SELECT current_user, version();'
# postgres | PostgreSQL 17.6 on x86_64-windows ...

docker --version
# docker : The term 'docker' is not recognized ...
# (Docker نصب نشده است)

docker compose version
# همان خطای بالا

git rev-parse --is-inside-work-tree
# fatal: not a git repository
```

### دیتابیس‌های موجود (برای مستندسازی؛ تغییر داده نشد)

```powershell
psql -w -U postgres -h localhost -p 5432 -d postgres -c 'SELECT datname FROM pg_database ORDER BY datname;'
# postgres, template0, template1, weshbazar, weshbazar_dev, weshbazar_shadow, weshbazar_test
```

## دستورهای برنامه‌ریزی‌شده (در فازهای بعد با خروجی واقعی پر می‌شود)

```bash
npm ci                 # نصب وابستگی‌ها به‌صورت reproducible
npm run build          # ساخت TypeScript
npm test               # تست‌های واحد
npm run test:e2e       # تست‌های یکپارچه/e2e
npm run lint           # ESLint
npm run format:check   # Prettier check
npm run openapi:validate
npm run db:generate    # تولید Prisma Client
npm run db:migrate:deploy
npm run db:status
npm run start:dev
```

> هر دستور فقط زمانی «موفق» ثبت می‌شود که واقعاً اجرا شده و خروجی آن سبز
> باشد. تا قبل از اجرا وضعیت `NOT RUN` ثبت می‌گردد.