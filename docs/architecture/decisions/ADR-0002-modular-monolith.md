# ADR-0002 — Modular Monolith

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

MVP این محصول دامنهٔ متوسط و تیم کوچک دارد. microservices سربار عملیاتی و
پیچیدگی نابه‌جا تحمیل می‌کند.

## تصمیم

معماری **Modular Monolith** با ماژول‌های feature-based. هر feature دارای
لایه‌هایی است:

- `api`: controller و DTO و mapping HTTP
- `application`: use-case/service و مرز transaction
- `domain`: قواعد کسب‌وکار
- `infrastructure`: Prisma query/repository و adapters

NestJS moduleهای feature-based؛ بدون circular dependency یا `forwardRef`
به‌عنوان default.

## گزینه‌های ردشده

- Microservices/Kafka/Redis/Kubernetes: خارج از MVP.
- CQRS/event bus کامل: سربار بدون نیاز.
- Generic repository برای هر کلاس: تشریفاتی.

## پیامد

- ماژول‌ها مستقل و قابل test.
- تراکنش‌های چندمرحله‌ای با Prisma transaction API داخل serviceها.
- در آینده اگر مقیاس ایجاب کرد، مرزها قابل استخراج به سرویس جدا هستند.