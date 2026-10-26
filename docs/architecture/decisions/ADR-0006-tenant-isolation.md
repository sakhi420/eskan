# ADR-0006 — جداسازی Tenant/سازمان

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

اطلاعات یک مالک نباید هرگز به مالک دیگر نشت کند.

## تصمیم

- `Organization` مرز امنیتی است؛ هر کاربر یک یا چند `organization_membership` دارد.
- سازمان فعال از security context و membership معتبر سمت سرور به‌دست می‌آید.
- header `X-Organization-Id` فقط selector است، نه authority.
- هر query tenant-scoped است؛ repositoryها `organization_id` را از context می‌گیرند.
- reference بین موجودیت‌ها ثابت می‌کند که والد نیز در همان سازمان است.
- UUID تصادفی جایگزین authorization نیست.

## پیامد

- برای همهٔ endpointها تست BOLA/IDOR نوشته می‌شود.
- permission matrix با roleها (OWNER/ADMIN/OPERATOR/VIEWER) enforce می‌شود.
- آخرین OWNER قابل حذف/تنزل نیست.