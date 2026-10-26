# ADR-0001 — پشتهٔ فنی و ماتریس نسخه

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

بک‌اند ESKAN باید روی Node.js با NestJS + TypeScript + Prisma + PostgreSQL
ساخته شود. مسترپرامپت استفاده از Kotlin/Spring Boot را ممنوع کرده و Flutter/Dart
را به مخزن موبایل محدود کرده است.

## تصمیم

پشتهٔ قطعی:

| جزء | نسخه | دلیل |
|-----|------|------|
| Node.js | 24.x (نصب‌شده v24.21.0) | LTS فعال؛ سازگار با Prisma engines `>=24.0` |
| TypeScript | 6.0.3 | سازگار با `@nestjs/schematics >=6`, `@nestjs/swagger ^6`, `ts-jest <7` |
| NestJS (core/common/platform-express) | 12.2.0 | آخرین stable |
| @nestjs/config | 12.0.1 | پیکربندی type-safe |
| @nestjs/swagger | 12.0.4 | OpenAPI |
| @nestjs/jwt | 12.0.3 | access token |
| Prisma / @prisma/client | 7.10.1 | آخرین stable (7.x)؛ `latest`=8.0.0-rc.27 رد شد چون RC |
| class-validator / class-transformer | 0.15.1 / 0.5.1 | validation |
| decimal.js | 10.6.0 | محاسبات دقیق پول |
| argon2 | 0.45.1 | Argon2id hashing |
| jest / ts-jest / supertest | 30.5.2 / 29.4.15 / 7.3.1 | تست |

## گزینه‌های ردشده

- Prisma 8.0.0-rc.27: release candidate، غیر قابل استفاده در production.
- TypeScript 7.0.2: پشتیبانی `@nestjs/swagger` (تا ^6) و `ts-jest` (<7) ندارد.
- Fastify adapter: نیاز اضافه بدون دلیل؛ Express پیش‌فرض.
- H2 در integration test: ممنوع؛ باید PostgreSQL واقعی.

## پیامد

- نسخه‌ها در `package.json` pin شده و `package-lock.json` commit می‌شود.
- CI از `npm ci` استفاده می‌کند.
- سازگاری Node 24 با Prisma طبق `engines` تأیید شد.