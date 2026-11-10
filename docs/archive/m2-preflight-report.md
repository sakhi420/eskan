> **سند تاریخی (آرشیو 2026-11-10) — برای اجرای فعلی پروژه مرجع نیست.** مرجع اجرایی فاز ۹: `ESKAN_PHASE9_EXECUTION_DIRECTIVE_v1_FA.md` · مرجع محصول: `docs/product/mvp-scope.md` · مرجع وضعیت: `docs/project/progress.md`.

# گزارش پیش‌بررسی M-2 (فقط‌خواندنی) — پوشش کامل

تاریخ: 2026-11-07 — وضعیت: **Read-only Preflight (تشخیصی)** — هیچ تغییری در data/schema انجام نشد.
نسخه: پس از تکمیل رابطهٔ Absence→Charge، اصلاح کلیدهای composite و تقویت CI.

## روش و ایمنی
- ابزار: `scripts/preflight-m2.cjs`
- **guard fail-closed:** فقط نام‌های دیتابیس آزمایشی روی host محلی مجاز است؛ در غیر این صورت `REFUSED` (override صریح: `PREFLIGHT_ALLOW=1`).
- کل ممیزی داخل `BEGIN TRANSACTION READ ONLY` و فقط `SELECT`.
- **دامنهٔ guard (دقیق):** محدود کردن host محلی + نام دیتابیس dev/test یک «دفاع در عمق» برای جلوگیری از اتصال تصادفی به دیتابیس اشتباه/غیرمحلی است؛ **تشخیص قطعی Port-Forwarding نیست**. راهکار واقعی، اجرای harness با نقش کم‌امتیازِ بدون `CREATEDB` یا روی سرور آزمایشی مستقل است.

## پوشش تشخیصی (inventory)
- **Cross-organization — ۱۶ بررسی:** Room→Hostel، Bed→Room، Contract→Hostel/Resident، Assignment→Bed/Resident/Contract، Charge→Resident/Contract، Payment→Resident، Deposit→Resident، Expense→Hostel، Allocation (payment.org vs charge.org)، Absence→Contract/Resident/**CreditCharge**.
- **Cross-resident — ۵ بررسی:** Assignment(contract)، Charge(contract)، Allocation(payment vs charge)، Absence(contract)، **Absence(creditCharge)**.
- **Orphan/بدون والد — ۱۶ بررسی:** شامل orphanِ `credit_charge_id` غیرتهی.
- **Composite-key readiness — ۱۱ کلید موردنیاز** (با تطبیق دقیق مجموعه و ترتیب ستون‌ها، و حذف index نامعتبر/آماده‌نشده از طریق `indisvalid`/`indisready`).

### رابطهٔ Absence→Charge (creditChargeId)
- `absence.creditCharge.org`: سازمان غیابت = سازمان Charge.
- `absence.creditCharge.resident`: ساکن غیابت = ساکن Charge.
- orphan برای `credit_charge_id` غیرتهی.
- در CI با **detection test** اثبات می‌شود: یک غیابت orgA/resA با `credit_charge_id` به Charge متعلق به orgB/resB کاشته می‌شود و preflight با `--strict` آن را با exit 1 شناسایی می‌کند.

## یافته‌های کلیدی (composite keys)
۱۱ کلید زیر همگی **MISSING** هستند و پیش‌نیاز composite-FK‌ها هستند:
| جدول | کلید لازم |
|---|---|
| hostels / rooms / beds / residents | `(organization_id, id)` |
| stay_contracts | `(organization_id, id)` + `(organization_id, resident_id, id)` |
| charges | `(organization_id, id)` + `(organization_id, resident_id, id)` |
| payments | `(organization_id, id)` + `(organization_id, resident_id, id)` |
| temporary_absences | `(organization_id, resident_id, id)` — فقط |

نکته: برای `temporary_absences` کلید دوستونی `(organization_id, id)` **لازم نیست**؛ چون هیچ رابطهٔ ارجاع‌دهنده‌ای آن را مصرف نمی‌کند (طبق `phase-9-engineering-plan.md` تنها کلید سه‌ستونی لازم است). کلیدهای دوستونیِ charges/payments به‌دلیل composite-FK رابطهٔ PaymentAllocation (و AbsenceCredit) لازم‌اند.

## تست تشخیصی در CI
- `scripts/test-m2-preflight-detection.cjs`: یک throwaway می‌سازد، ناسازگاری cross-org/cross-residentِ `creditCharge` می‌کارد و اطمینان می‌دهد preflight `--strict` با exit 1 آن را گزارش می‌کند.
- مرحلهٔ CI `M-2 preflight detection (seeded cross-tenant anomalies)` این را هر بار اجرا می‌کند (تکرارپذیر).
- مرحلهٔ CI `M-2 preflight guard (fail-closed on non-test DB)` مسیر fail-closed guard را با نام دیتابیس غیرآزمایشی (exit 2) آزمایش می‌کند.

## تفکیک مهم: demo/test در برابر clone واقعی
اعدادی که در هر اجرای آزمایشی دیده می‌شوند نتیجهٔ دادهٔ **مصنوعی یا خالی** است و **وضعیت دیتابیس واقعی ESKAN نیست**. پیش از هر migration، همین ابزار باید روی یک **clone معتبر و فقط‌خواندنی دیتابیس مبنای توسعه** اجرا شود.

## پیشنهاد ترتیب migration آینده (بدون اجرا — نیازمند مجوز جداگانه)
1. `UNIQUE(organization_id, id)` روی hostels/rooms/beds/residents/stay_contracts/charges/payments.
2. `UNIQUE(organization_id, resident_id, id)` روی stay_contracts/charges/payments/temporary_absences.
3. composite-FK tenant/resident-scoped روی روابط (چهارچوب بالا).
4. `PaymentAllocation`: تصمیم دربارهٔ `organization_id`/`resident_id` + composite-FK دوگانهٔ `→ Payment` و `→ Charge`.
5. `TemporaryAbsence.creditCharge`: کنترل org+resident (یا تبدیل به ساختار `AbsenceCredit`).

## محدودیت‌های رعایت‌شده
- هیچ `ALTER`/`CREATE`/`DROP`/migration، `UPDATE`/backfill، FK/index/constraint، تغییر `PaymentAllocation`/`LockService`، کد production یا OpenAPI انجام نشد.
- preflight فقط روی clone/دیتابیس آزمایشی throwaway اجرا شد؛ نه روی دیتابیس عملیاتی.
- M-3 و سرویس‌ها/کنترلرهای مالی شروع نشد.