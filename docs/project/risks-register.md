# ثبت ریسک‌ها — ESKAN Backend

| ID | ریسک | احتمال | اثر | وضعیت | کاهش | صاحب |
|----|------|--------|-----|--------|------|------|
| R-001 | Docker/Testcontainers در این ماشین نصب نیست؛ integration tests مبتنی بر Testcontainers قابل اجرای محلی نیست | High | High | MITIGATED | از PostgreSQL محلی واقعی (17.6) با دیتابیس اختصاصی `eskan_test` استفاده می‌شود؛ `docker-compose.yml` گزینهٔ محیط Docker است ولی در این ماشین NOT RUN ثبت می‌شود | مهندس بک‌اند |
| R-002 | سرور PostgreSQL مشترک با پروژهٔ دیگر (weshbazar) | Medium | High | MITIGATED | از prefix اختصاصی `eskan` برای دیتابیس/role استفاده می‌شود؛ هرگز `weshbazar*` لمس نمی‌شود | مهندس بک‌اند |
| R-003 | auth محلی PostgreSQL از نوع `trust` (بدون رمز) | Medium | Medium | ACCEPTED | صرفاً مخصوص توسعهٔ محلی؛ در prod credential اجباری + fail-fast config؛ `.env` commit نمی‌شود | مهندس بک‌اند |
| R-004 | نبود قطعیت دربارهٔ سیاست‌های مالی | High | Medium | CLOSED | با A-015 (proration)، A-016 (پول integer) و D-01..D-18 قطعی شد؛ سؤال‌های باز باقی‌مانده در `docs/domain/assumptions-register.md` | مالک محصول |
| R-005 | سازگاری Node v24 با وابستگی‌ها | Low | Medium | CLOSED | نسخه‌ها از مستندات رسمی و npm بررسی و در `package.json` pin شدند | مهندس بک‌اند |
| R-006 | حجم بالای scope در برابر محدودیت context | High | Medium | MITIGATED | پیشروی فاز‌به‌فاز، checkpointهای تکرارپذیر، تمرکز روی هستهٔ اقامت و مالی | مهندس بک‌اند |

> **وضعیت‌ها:** `OPEN` / `MITIGATED` / `CLOSED` / `ACCEPTED`. ریسک محیط توسعه (R-001/R-003) نقص دائمی معماری محصول نیست.

## یادداشت

- هیچ secret یا دادهٔ واقعی تاکنون در Git یا log مشاهده نشده است.
- هیچ فایل، migration یا دادهٔ موجودی حذف نشده است.