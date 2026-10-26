# ADR-0008 — اسناد مالی و reversals

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

اسناد مالی قطعی نباید حذف/بازنویسی شوند؛ اصلاح از reversal قابل پیگیری باشد.

## تصمیم

- Charge/Payment/Expense posted حذف فیزیکی نمی‌شوند؛ `POSTED → REVERSED` با
  دلیل و actor و reference به سند اصلی.
- Deposit رویداد مستقل است (`RECEIVED`/`REFUNDED`/`FORFEITED`)؛ اصلاح اشتباه
  اساساً با reverse، نه با negative amount.
- negative amount برای reversal ممنوع.
- مانده از اسناد معتبر محاسبه می‌شود (Charge − Allocation − reversal).
- مجموع allocation فعال هر payment/charge از amount معتبر بیشتر نمی‌شود.
- تمام عملیات مالی چندجدولی در transaction.

## پیامد

- `reversal` فیلد reason + reference + version.
- reconciliation مستقل مانده در تست‌ها تأیید می‌شود.