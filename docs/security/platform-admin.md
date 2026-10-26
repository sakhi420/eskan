# Platform Admin — نقش سطح سیستم و مجوزها

## تعریف

Platform Admin هویت/مجوز **سطح سیستم** است (system-level role)، جدا از `OWNER`/`ADMIN`
سازمان. داشتن `OWNER` در یک سازمان **کافی نیست**.

## Bootstrap

- اولین Platform Admin فقط از مسیر امن CLI/seed ساخته می‌شود (فرمان مستند، secret از env).
- هیچ endpoint عمومی برای ارتقای کاربر به Platform Admin وجود ندارد.
- هیچ credential پیش‌فرض در repo/Git نیست.

## مجوزها (در OpenAPI + enforce سمت سرور)

همهٔ مسیرهای `/api/v1/admin/**` نیازمند `PLATFORM_ADMIN` در JWT هستند. نقش در authentication
context قرار می‌گیرد و در هر درخواست بررسی می‌شود (نه فقط در ورود).

| مسیر | اقدام |
|------|-------|
| `GET /admin/organizations` | فهرست/جست‌وجوی سازمان‌ها (کمینهٔ PII) |
| `GET /admin/organizations/{id}/subscription` | مشاهده اشتراک |
| `GET .../subscription/history` | تاریخچه |
| `POST .../subscription/activate` | فعال‌سازی طرح پولی پس از تأیید دستی |
| `POST .../subscription/extend` | تمدید دوره |
| `POST .../subscription/change-plan` | تغییر طرح |
| `POST .../subscription/suspend` / `/resume` | تعلیق/ازسرگیری |
| `POST .../subscription/grant-grace` | اعطای grace |
| `POST .../subscription/payments` | ثبت پرداخت دستی تأییدشده |

هر mutation دارای audit event append-only + idempotency (فعال‌سازی/پرداخت اجباری).

## تهدیدها (خلاصه)

- BOLA/IDOR روی `organizationId` در مسیرهای admin → هر درخواست باید role سنجیده شود.
- mass assignment: فیلدهای `verifiedByUserId`/`actorUserId` از client پذیرفته نمی‌شوند.
- ثبت activation فقط با actor مجاز + بررسی دستی؛ مقدار `status` از client معتبر نیست.
- تاریخچه پاک/بازنویسی نمی‌شود.