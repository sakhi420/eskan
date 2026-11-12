# مدل خطا — ESKAN

All errors follow RFC 9457 Problem Details with stable extensions.

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "The resource has changed since it was read.",
  "instance": "/api/v1/beds/00000000-0000-4000-8000-000000000001",
  "code": "RESOURCE_VERSION_CONFLICT",
  "traceId": "example-trace-id"
}
```

## Status codes

| کد | معنا |
|----|------|
| 400 | درخواست نامعتبر عمومی |
| 401 | نبود/نامعتبر بودن authentication |
| 403 | کاربر authenticated بدون permission |
| 404 | منبع یافت نشد (یا عدم افشای وجود) |
| 409 | تعارض نسخه/وضعیت/idempotency/assignment |
| 422 | validation با لیست فیلدها |
| 429 | rate limiting |
| 500 | خطای غیرمنتظره + traceId، بدون جزئیات |

## code های پایدار (خلاصه — منطبق با `src/common/errors/error-codes.ts`)

`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`,
`RESOURCE_VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`,
`DUPLICATE_RECEIPT_NUMBER`, `BED_ASSIGNMENT_OVERLAP`, `RESIDENT_CONTRACT_OVERLAP`,
`CONTRACT_NOT_ACTIVE`, `CHARGE_ALREADY_REVERSED`, `PAYMENT_ALREADY_REVERSED`,
`ALLOCATION_EXCEEDS_PAYMENT`, `PLAN_LIMIT_EXCEEDED`, `DEPOSIT_BALANCE_INSUFFICIENT`,
`SYNC_RESYNC_REQUIRED`, `SYNC_CURSOR_INVALID`, `BUSINESS_RULE_VIOLATION`,
`ORGANIZATION_CONTEXT_REQUIRED`, `RATE_LIMITED`, `REGISTRATION_DISABLED`, `DUPLICATE_CODE`,
`RESOURCE_HAS_ACTIVE_ASSIGNMENT`, `REFRESH_TOKEN_REUSED`, `REFRESH_TOKEN_ROTATION_CONFLICT`,
`AMOUNT_OUT_OF_RANGE`, `ALLOCATION_EXCEEDS_CHARGE`, `ALLOCATION_ALREADY_RELEASED`,
`RELEASE_EXCEEDS_ALLOCATION`, `DEPOSIT_ALREADY_REVERSED`, `EXPENSE_ALREADY_REVERSED`,
`PAYMENT_REFUND_EXCEEDS_UNALLOCATED`, `REFUND_EXCEEDS_DEPOSIT_BALANCE`, `CHECKOUT_REQUIRED`,
`RESIDENT_MISMATCH`, `BILLING_RUN_DUPLICATE`, `ABSENCE_ALREADY_CREDITED`, `INTERNAL_ERROR`.

> فهرست بالا ثابت‌های enum واقعی است (نه کپی از گزارش تاریخی). کدهای مالی/sync در enum تعریف
> شده‌اند؛ enforcement آن‌ها در endpoint مربوطه هنگام پیاده‌سازی آن endpoint فعال می‌شود.

## خطای validation

`errors` شامل آرایهٔ `{field, code, message}` است. stack trace/SQL/path/secret
هرگز افشا نمی‌شود.