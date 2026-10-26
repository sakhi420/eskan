# ADR-0007 — همگام‌سازی آفلاین و تعارض‌ها

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

اپ موبایل باید بخشی از گردش کار را آفلاین ادامه دهد و بعداً همگام شود.

## تصمیم

- **Mutation queue:** کلاینت آفلاین همان REST mutationها را با
  `Idempotency-Key` پایدار پس از اتصال می‌فرستد (بدون API تبدیل JSON دلخواه).
- **Pull changes** با cursor سازمانی:
  - `organization_sync_state` cursor/sequence؛
  - `sync_changes` شامل sequence, organization, entityType, entityId,
    action (`UPSERT`/`TOMBSTONE`), entityVersion, occurredAt؛
  - رویداد در همان transaction نوشتن entity ثبت می‌شود؛
  - sequence سازمانی با row lock تراکنشی تضمین order می‌شود (sequence خام
    PostgreSQL ترتیب commit را تضمین نمی‌کند).
- tombstone برای archive/delete منطقی لازم است.
- تعارض نسخه با `expectedVersion` → 409.
- هرگز last-write-wins برای دادهٔ حیاتی.

## پیامد

- کلاینت cursor را فقط پس از ذخیرهٔ اتمیک صفحه در SQLite/Drift پیش می‌برد.
- cursor قدیمی‌تر از retention → `SYNC_RESYNC_REQUIRED`.
- پاسخ per-operation: `APPLIED`/`DUPLICATE`/`CONFLICT`/`VALIDATION_FAILED`/
  `FORBIDDEN`/`RETRYABLE_FAILURE`.