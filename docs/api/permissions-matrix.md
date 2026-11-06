# ماتریس مجوزها — ESKAN

نقش‌ها: `OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`.

## ماتریس نقش‌ها

| عملیات (endpoint) | OWNER | ADMIN | OPERATOR | VIEWER |
|--------|-------|-------|----------|--------|
| خواندن همهٔ منابع (GET) | ✅ | ✅ | ✅ | ✅ |
| پروفایل سازمان (ویرایش) | ✅ | ❌ | ❌ | ❌ |
| مدیریت اعضا/نقش‌ها | ✅ | ❌ | ❌ | ❌ |
| لیلیه/اتاق/بستر (ایجاد/ویرایش/archive) | ✅ | ✅ | ❌ | ❌ |
| ساکن (ثبت) | ✅ | ✅ | ✅ | ❌ |
| ساکن (ویرایش/archive) | ✅ | ✅ | ❌ | ❌ |
| قرارداد (ایجاد/activate/checkout) | ✅ | ✅ | ✅ | ❌ |
| تخصیص/پایان تخصیص بستر | ✅ | ✅ | ✅ | ❌ |
| Charge عادی (ایجاد) | ✅ | ✅ | ✅ | ❌ |
| Credit/تخفیف (Charge با entrySide=CREDIT) | ✅ | ✅ | ❌ | ❌ |
| Payment (ایجاد/تخصیص) | ✅ | ✅ | ✅ | ❌ |
| ودیعه (دریافت depositCreate) | ✅ | ✅ | ✅ | ❌ |
| ودیعه apply/refund/forfeit | ✅ | ✅ | ❌ | ❌ |
| Expense (ثبت) | ✅ | ✅ | ✅ | ❌ |
| Reversal/Void (هر سند مالی) | ✅ | ✅ | ❌ | ❌ |
| Billing preview | ✅ | ✅ | ✅ | ✅ |
| Billing post (صدور قطعی) | ✅ | ✅ | ❌ | ❌ |
| AbsenceCredit (تولید) | ✅ | ✅ | ✅ | ❌ |
| گزارش‌ها | ✅ | ✅ | ✅ | ✅ |
| sync/read | ✅ | ✅ | ✅ | ✅ |
| change-password (خود) | ✅ | ✅ | ✅ | ✅ |

## سیاست cross-tenant و خطاها

- `organizationId` همیشه از security context؛ هرگز از body/query.
- عدم عضویت در سازمانِ درخواستی → **404** (نه 403) برای جلوگیری از افشای وجود منبع.
- عضویت دارد ولی نقش کافی ندارد → **403** `FORBIDDEN`/`INSUFFICIENT_ROLE`.
- همهٔ enforcement سمت سرور؛ مخفی‌کردن دکمه در UI مجوز نیست.

## نکات

- آخرین OWNER قابل حذف/تنزل نیست (409).
- نقش‌های مالی حساس (refund/forfeit/apply/reversal/credit/صدور قطعی کرایه) فقط OWNER/ADMIN.