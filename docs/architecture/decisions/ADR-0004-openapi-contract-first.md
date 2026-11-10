# ADR-0004 — OpenAPI Contract-First

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

قرارداد API باید پیش از endpointها تثبیت شود تا فرانت‌اند آینده بر اساس حدس
ساخته نشود.

## تصمیم

- `contracts/openapi.yaml` منبع حقیقت قرارداد عمومی است.
- همهٔ routeهای محصول زیر `/api/v1`؛ health probes مسیر عملیاتی جدا.
- JSON UTF-8، `camelCase`، enumها uppercase.
- خطاها RFC 9457 Problem Details با `code` پایدار و `traceId`.
- مبلغ عدد صحیح AFN در ساختار `Money { amount: integer, currency: "AFN" }` (A-016)؛ هرگز دقت اعشاری/string ده‌دهی.
- timestamp RFC 3339 UTC؛ تاریخ کاری `YYYY-MM-DD`.
- موجودیت mutable دارای `version`؛ update با `expectedVersion`/`If-Match` و 409.

## تولید کد

- تولید server interface از OpenAPI با generator بررسی شد؛ به‌دلیل پیچیدگی و
  وابستگی نسخه، DTO/controllerهای دستی نگهداری می‌شوند و contract test drift
  را آشکار می‌کند. هیچ specification موازی ساخته نمی‌شود.

## پیامد

- lint/validation OpenAPI در npm scripts.
- Swagger UI صرفاً نمایش قرارداد است، نه منبع دوم.