# ADR-0010 — اشتراک، Trial و فعال‌سازی دستی

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

مسترپرامپت v3.0 مدیریت اشتراک نرم‌افزار را داخل scope بک‌اند آورد (نه پرداخت آنلاین/پنل وب).
باید Trial قابل تنظیم، طرح‌های Free/PRO/BUSINESS با entitlements سرور-محور، تنزل امن به
Free و APIهای Platform Admin برای فعال‌سازی/تمدید/تعلیق و ثبت پرداخت تأییدشده داشته باشیم؛
کاملاً جدا از Charge/Payment/Deposit/Expense ساکنان.

## تصمیم

1. **تمرکز مجوز در backend:** همهٔ محدودیت‌ها و entitlements سمت سرور enforce می‌شوند؛
   مخفی‌کردن قابلیت در موبایل فقط تجربهٔ کاربری است.
2. **Trial خودکار:** با ایجاد سازمان + عضویت OWNER، یک `OrganizationSubscription` با
   `status=TRIALING` و مدت پیش‌فرض ۳۰ روز (قابل تنظیم) ساخته می‌شود؛ شروع/پایان فقط با زمان
   سرور (UTC/TIMESTAMPTZ)، نه زمان کلاینت.
3. **طرح‌ها دادهٔ قابل تنظیم‌اند:** `SubscriptionPlan` با `PlanLimits` (سقف‌های nullable به
   معنی نامحدود + ویژگی‌های boolean). قیمت قطعی فرض نمی‌شود (`priceAmount` nullable).
4. **تنزل امن:** پایان Trial → `FREE`؛ پس از انقضای اشتراک پولی → `GRACE_PERIOD` با پیش‌فرض
   ۷ روز (قابل تنظیم) → `FREE`. دادهٔ موجود حذف/پنهان نمی‌شود؛ فقط ایجاد رکورد فراتر از سقف
   با `PLAN_LIMIT_EXCEEDED` رد می‌شود.
5. **سابقه append-only:** `SubscriptionAuditEvent` قابل پاک/بازنویسی نیست؛ اصلاح با رویداد
   اصولاحی.
6. **Platform Admin جدا از نقش سازمان:** هویت سطح سیستم (system role `PLATFORM_ADMIN`)
   است؛ ارتقای خودکار ممنوع؛ bootstrap امن/CLI. هیچ endpoint عمومی برای سیستم‌اَدِمین شدن نیست.
7. **پرداخت اشتراک جدا:** `ManualSubscriptionPayment` هرگز با `Payment` ساکن مخلوط نمی‌شود و
   در گزارش دریافتی کرایهٔ مشتری ظاهر نمی‌شود.
8. **فعال‌سازی اتمیک:** فعال‌سازی/تمدید/تغییر طرح/تعلیق و ثبت پرداخت در یک transaction با
   audit و idempotency انجام می‌شود؛ `startsAt = max(now, currentPeriodEnd)` تا روز باقی‌مانده
   از بین نرود.
9. **Google Play مصرف‌محور:** هیچ checkout/لینک/دکمه پرداخت در API عمومی ساخته نمی‌شود؛
   جریان درون‌اپی فقط نمایش وضعیت است.

## پیامد

- جداول Prisma جدید: `subscription_plans`, `organization_subscriptions`,
  `subscription_audit_events`, `manual_subscription_payments`.
- `PlanLimits` در Prisma به‌صورت JSONB نوع‌دار (validated در runtime) یا ستون‌های صریح.
- تست‌های اجباری بخش «چرخهٔ اشتراک» (۱۴ سناریو) باید پاس شوند.