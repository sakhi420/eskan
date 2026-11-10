# همگام‌سازی آفلاین — ESKAN (قرارداد هدف برای کلاینت آینده)

> ⚠️ **وضعیت (2026-11-10):** این سند **قرارداد هدف** است. تفکیک وضعیت اجرا:
> - **Write-side Audit/Sync:** در Postingهای M3a (`SyncChange`/PostingService در همان transaction) وجود دارد.
> - **Pull API / Tombstone / Full Resync / Client Sync کامل:** هنوز پیاده‌سازی نشده‌اند (M3d).
> Controller/ماژول عملیاتی Sync هنوز ساخته نشده؛ جداول `sync_changes` فقط در schema تعریف شده‌اند و Pull عملیاتی نیست. صرف وجود `SyncChange`/`PostingService` به‌معنای تکمیل Sync API نیست.

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

## وضعیت محلی و تأیید سرور

- `PENDING_SYNC` یک **وضعیت محلی کلاینت** است (نوشتهٔ هنوز تأییدنشده) و نباید با وضعیت
  سند قطعی سرور (`POSTED`/`ISSUED`) یکی گرفته شود.
- کلاینت آفلاین `provisionalReceiptId` محلی می‌سازد؛ `receiptNumber`/رسید رسمی فقط پس از
  commit سرور صادر و در sync بازگردانده می‌شود (D-03/D-17). دو شناسه جدا نگه داشته می‌شوند.
- تعارض با `X-Expected-Version` یا `Idempotency-Key` → 409 با وضعیت/نسخهٔ فعلی؛ کلاینت پیش از
  retry re-sync می‌کند (بدون Last-write-wins).

## Backup / Restore (الزام مستقل از Sync)

- **Backup محلی (کلاینت):** SQLite/Drift به‌صورت دوره‌ای/دستی export می‌شود؛ قابل Restore
  مستقل از سرور (کاربر اینترنت محدود دارد). رمزنگاری/محافظت دستگاه گم‌شده طبق OWASP.
- **Backup مرکزی (سرور):** PostgreSQL backup دوره‌ای + **تمرین Restore واقعی** قبل از pilot؛
  این الزام جدا از Sync است و در `docs/product/mvp-scope.md` نیز ثبت شده است.