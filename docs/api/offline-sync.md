# همگام‌سازی آفلاین — ESKAN (قرارداد هدف برای کلاینت آینده)

> ⚠️ **وضعیت:** این سند **قرارداد هدف** است، نه قابلیتِ اجراشدهٔ فعلی. در مخزن فعلی
> Controller/ماژول عملیاتی Sync هنوز ساخته نشده‌اند؛ جداول `sync_changes` فقط در schema
> تعریف‌شده‌اند و تا پیاده‌سازی M-3d/M-4 عملیاتی نیستند.

بک‌اند sync را تا حد زیر هدف می‌گیرد؛ منطق Flutter/Drift یا UI موبایل در این مخزن
ساخته نمی‌شود.

## Mutation queue (نوشتن آفلاین)

1. کلاینت آفلاین عملیات را به‌صورت محلی queue می‌کند.
2. پس از اتصال، همان REST mutation را با `Idempotency-Key` **پایدار** می‌فرستد.
3. برای ادغام سرور، cada mutation همان endpoint را با version/expectedVersion
   دارد؛ هیچ API تبدیل JSON دلخواه به entity عمومی وجود ندارد.

## Pull changes

`GET /api/v1/sync/changes?afterSequence=N&limit=100`

- هر entity-change یک `sync_changes` با `sequence` سازمانی monotone دارد.
- رویداد در همان transaction نوشتن entity ثبت می‌شود (نه sequence خام PG).
- پاسخ: `changes[], nextCursor, hasMore, minAvailableCursor, schemaVersion, resyncRequired`.

```json
{
  "data": {
    "changes": [
      {
        "sequence": 42,
        "entityType": "resident",
        "entityId": "uuid",
        "action": "UPSERT",
        "entityVersion": 3,
        "occurredAt": "2026-10-25T10:00:00Z"
      }
    ],
    "nextCursor": 42,
    "hasMore": false,
    "minAvailableCursor": 1,
    "schemaVersion": 1,
    "resyncRequired": false
  },
  "meta": { "traceId": "..." }
}
```

## قواعد client

- cursor فقط پس از ذخیرهٔ **اتمیک** همهٔ صفحه در SQLite/Drift پیش می‌رود.
- اگر `resyncRequired` یا کد `SYNC_RESYNC_REQUIRED` آمد، full resync.
- tombstone (`action: TOMBSTONE`) یعنی entity منطقاً حذف/archive شده؛
  client نباید آن را فقط نامرئی فرض کند.
- تعارض نسخه با `expectedVersion` → 409 با نسخهٔ فعلی.

## پاسخ per-operation (mutation)

`APPLIED`, `DUPLICATE`, `CONFLICT`, `VALIDATION_FAILED`, `FORBIDDEN`,
`RETRYABLE_FAILURE` (قرارداد sync).