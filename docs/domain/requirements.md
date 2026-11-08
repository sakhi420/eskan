# نیازمندی‌ها — اسکان (ESKAN) Backend

اولویت‌ها: `MUST` / `SHOULD` / `COULD`. هر نیازمندی با سناریوی پذیرش (AS) پیوند دارد.

## نیازمندی‌های کارکردی (REQ-F)

| ID | اولویت | نیازمندی | پذیرش (AS) |
|----|--------|----------|------------|
| REQ-F-001 | MUST | ثبت حساب مالک و ایجاد سازمان در یک transaction با role OWNER | AS-001 |
| REQ-F-002 | MUST | ورود، خروج، تمدید و لغو همهٔ نشست‌ها (refresh rotation) | AS-002 |
| REQ-F-003 | MUST | مدیریت پروفایل سازمان و اعضا با کنترل مالک | AS-003 |
| REQ-F-004 | MUST | CRUD + archive لیلیه | AS-004 |
| REQ-F-005 | MUST | CRUD + archive اتاق | AS-004 |
| REQ-F-006 | MUST | CRUD + deactivate بستر | AS-004 |
| REQ-F-007 | MUST | ثبت ساکن با نوع STUDENT/WORKER/OTHER | AS-005 |
| REQ-F-008 | MUST | ثبت قرارداد اقامت با کرایه/تاریخ/وضعیت | AS-006 |
| REQ-F-009 | MUST | تخصیص/پایان تخصیص بستر با جلوگیری از overlap | AS-007 |
| REQ-F-010 | MUST | ثبت صورتحساب (charge) | AS-008 |
| REQ-F-011 | MUST | ثبت دریافت، تقسیم جزئی و تخصیص به صورتحساب | AS-008 |
| REQ-F-012 | MUST | ثبت ودیعه و برگشت آن جدا از کرایه | AS-009 |
| REQ-F-013 | MUST | ثبت و reversal هزینه | AS-010 |
| REQ-F-014 | MUST | نمایش حساب ساکن، بدهی، دریافت‌ها و تاریخچه | AS-011 |
| REQ-F-015 | MUST | گزارش‌های پایه: dashboard/occupancy/receivables/financial/statement | AS-012 |
| REQ-F-016 | MUST | audit برای عملیات حساس | AS-013 |
| REQ-F-017 | MUST | API همگام‌سازی pull با cursor پایدار و tombstone | AS-014 |
| REQ-F-018 | MUST | idempotency و تشخیص تعارض برای writes | AS-015 |
| REQ-F-019 | MUST | جداسازی tenant روی همهٔ endpointها | AS-016 |
| REQ-F-020 | SHOULD | درخواست ترمیمات | AS-017 |
| REQ-F-021 | SHOULD | دعوت عضو با توکن یک‌بارمصرف | AS-018 |
| REQ-F-022 | COULD | خروجی CSV امن | — |

## نیازمندی‌های غیرکارکردی (REQ-NF)

| ID | اولویت | نیازمندی |
|----|--------|----------|
| REQ-NF-001 | MUST | مبالغ عدد صحیح AFN (`Money.amount` integer طبق A-016)؛ گردکردن نیم‌به‌بالا با decimal.js و ذخیرهٔ integer؛ هرگز Float/Double |
| REQ-NF-002 | MUST | اعتبارسنجی همهٔ ورودی‌ها؛ رد فیلد ناشناخته |
| REQ-NF-003 | MUST | خطاها با RFC 9457 Problem Details + code پایدار + traceId |
| REQ-NF-004 | MUST | عملیات مالی/اقامت چندجدولی در transaction |
| REQ-NF-005 | MUST | hashing رمز Argon2id |
| REQ-NF-006 | MUST | refresh token hash در DB، rotation و revoke |
| REQ-NF-007 | MUST | timestamps به UTC و `timestamptz` |
| REQ-NF-008 | MUST | OpenAPI contract-first به‌عنوان منبع حقیقت |
| REQ-NF-009 | MUST | pagination صریح و sort allow-list |
| REQ-NF-010 | MUST | optimistic locking با version |
| REQ-NF-011 | MUST | لاگ ساختاریافته با redaction و correlation id |
| REQ-NF-012 | MUST | CORS فقط origin مشخص؛ HTTPS در production |
| REQ-NF-013 | MUST | conformed secret/env و fail-fast config |
| REQ-NF-014 | SHOULD | Testcontainers در CI (محلی از PostgreSQL واقعی موجود) |