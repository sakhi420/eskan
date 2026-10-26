# ADR-0003 — PostgreSQL و Prisma

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

دیتابیس مرکزی PostgreSQL و ORM باید تعیین شوند.

## تصمیم

- PostgreSQL 17 (نصب‌شده محلی 17.6) به‌عنوان دیتابیس رابطه‌ای.
- Prisma ORM با `schema.prisma` و Prisma Migrate.
- migrationها از راه `prisma migrate dev` ساخته و در production با
  `prisma migrate deploy` اعمال می‌شوند؛ `db push` در production ممنوع.
- migration منتشرشده immutable است.

## قواعد schema

- tenant scoping صریح برای جدول‌های tenant-owned.
- مبالغ `NUMERIC(19,2)`؛ در TS از `decimal.js`.
- uuid برای شناسهٔ داخلی؛ شمارهٔ سند/رسید sequence مجزا.
- `timestamptz` برای زمان سیستم؛ `DATE` برای تاریخ کاری.
- جلوگیری از overlap بستر با exclusion constraint `daterange` + `btree_gist`
  (در صورت پشتیبانی extension در محیط) + row lock برای race safety.

## گزینه‌های ردشده

- db push در production: ممنوع.
- ORM دیگر (TypeORM/MikroORM): Prisma تثبیت‌شده و ماتریس نسخه روشن.

## پیامد

- migrationها در `prisma/migrations` commit می‌شوند.
- integration tests روی PostgreSQL واقعی (local `eskan_test`).