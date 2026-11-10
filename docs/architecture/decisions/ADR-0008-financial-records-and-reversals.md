# ADR-0008 — اسناد مالی و reversals

- **وضعیت:** Accepted
- **تاریخ:** 2026-10-25

## زمینه

اسناد مالی قطعی نباید حذف/بازنویسی شوند؛ اصلاح از reversal قابل پیگیری باشد.

## تصمیم

- اسناد مالی قطعی (Charge/Payment/Expense) حذف فیزیکی نمی‌شوند؛ اصلاح با status/رویداد معکوس append-only با دلیل و actor و reference.
- تفکیک مفاهیم (D-02): `Charge` تعهد، `Payment` وجه وصول‌شدهٔ unapplied، `Allocation` تخصیص صریح،
  `AllocationRelease` آزادسازی (append-only)، `Deposit` تضمین جدا، `PaymentRefund` خروج واقعی وجه،
  `LedgerReversal` رویداد معکوس. **Refund واقعی ≠ Void سند اشتباه.**
- negative amount ممنوع؛ جهت با رویداد/`entrySide` بیان می‌شود (A-016).
- مانده از اسناد معتبر محاسبه می‌شود (Charge − Allocation − تعدیلات رسمی).
- مجموع allocation فعال هر payment/charge از amount معتبر بیشتر نمی‌شود؛ allocation بین دو Resident متفاوت ممنوع (D-05).
- تمام عملیات مالی چندجدولی در transaction با ترتیب قفل canonical (Organization → Resident → Contract → Charge → Payment → ...).

## پیامد

- `reversal` فیلد reason + reference + version.
- reconciliation مستقل مانده در تست‌ها تأیید می‌شود.