# مدل تهدید — ESKAN Backend

دامنه: MVP بک‌اند + قرارداد API (بدون فرانت‌اند).

| ID | تهدید | بردار | کنترل | وضعیت MVP |
|----|-------|-------|-------|-----------|
| T-001 | دسترسی بین‌سازمانی (BOLA/IDOR) | UUID حدس‌زدنی + عدم scope query | tenant scoping از context + تست BOLA روی همهٔ endpointها | MUST |
| T-002 | سرقت refresh token | افشا/steal | hash در DB + rotation + revoke reuse + logout-all | MUST |
| T-003 | brute force login | تکرار رمز | throttling/rate limit + قفل موقت | MUST |
| T-004 | mass assignment | Prisma model به body | DTO مجزا + forbidUnknownProperties + whitelist | MUST |
| T-005 | replay درخواست نوشتنی | retry تکراری | Idempotency-Key + unique constraint | MUST |
| T-006 | افشای PII (تماس ساکن) | لاگ/response | minimization در DTO و log redaction | MUST |
| T-007 | SQL injection در sort/filter | ورودی خام | allow-list + parameter binding | MUST |
| T-008 | سرقت secret | Git/log | env/secret manager + .gitignore + redaction | MUST |
| T-009 | همگام‌سازی ناسازگار | cursor skip/tombstone | sequence تراکنشی + tombstone + resync | MUST |
| T-010 | double allocate/over-allocate | race مالی | tx + lock + constraint + version | MUST |
| T-011 | بازنویسی تاریخچه (last-write-wins) | update بدون version | optimistic locking + 409 | MUST |
| T-012 | DoS از قفل دائمی | login قفل | قفل موقت کوتاه | MUST |
| T-013 | CORS/HTTPS | prod | فقط origin مشخص + HTTPS | MUST |
| T-014 | زمان ناامن از کلاینت | created/posted | زمان سرور | MUST |

## نکته

این مدل با OWASP API Security Top 10 تطبیق داده شده و در فاز 12 با شواهد
Pass/Fail/N.A. بازبینی می‌شود. هیچ ادعای گواهی امنیتی رسمی مطرح نیست.