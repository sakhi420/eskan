# ADR-0005 — احراز هویت و نشست‌ها

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

احراز هویت برای اپ اندروید آفلاین‌اول با نیاز به نشست طولانی و revoke قوی.

## تصمیم

- access token کوتاه‌عمر (JWT, HS256) با issuer/audience و clock skew مشخص.
- refresh token بلندعمر opaque؛ فقط hash آن در DB ذخیره می‌شود (SHA-256).
- rotation refresh: هر refresh → صدور token جدید و ابطال قبلی.
- reuse refresh (مصرف‌شده/منقضی) → revoke خاندان و 401.
- logout (جاری) و logout-all (همهٔ نشست‌های کاربر).
- رمز با Argon2id (`argon2`) hash می‌شود.
- login throttling/rate limit + قفل موقت؛ بدون قفل دائمی.
- errorهای ورود وجود username را افشا نمی‌کند.

## گزینه‌های ردشده

- Passport strategy کامل: سربار برای MVP؛ از `@nestjs/jwt` و سرویس دستی استفاده می‌شود.
- ذخیرهٔ refresh به plaintext: ممنوع.
- JWT با lifetime بلند برای access: ممنوع.

## پیامد

- جدول `refresh_sessions` با hash + خاندان (family) برای rotation.
- secretها از environment؛ هرگز در Git.