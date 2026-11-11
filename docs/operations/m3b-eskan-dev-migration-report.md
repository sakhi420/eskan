# گزارش اجرای Migration M3b روی `eskan_dev`

**تاریخ و ساعت (Asia/Kabul):** 2026-11-11 ~12:26 AFT

**وضعیت:** PASS

---

## خلاصه

Migrationهای M3a (۳ فایل) و M3b (۲ فایل) که روی `eskan_dev` معطل بودند، پس از Preflight، Backup معتبر، Rehearsal روی clone واقعی و Postflight، با `prisma migrate deploy` روی دیتابیس توسعه اعمال شدند و Postflight نهایی موفق بود.

---

## Git

| مورد | مقدار |
|---|---|
| Branch | `main` |
| SHA (مبنای Migration) | `8d9ef398a0af08f1e866ff36fb00935093a0162d` |
| Working tree | پاک (clean) |
| آخرین `origin/main` | `8d9ef398a0af08f1e866ff36fb00935093a0162d` |

Merge commit مربوط به M3b: `198423c6459dd385e1dc905bdd9314de3a29f746`

---

## دیتابیس هدف

| مورد | مقدار |
|---|---|
| Database | `eskan_dev` |
| Host | `127.0.0.1` (لوپ‌بک محلی) |
| PostgreSQL version | 17.6 |
| Target verified | YES (`current_database()=eskan_dev`، `current_user=postgres`) |

---

## Preflight

- **Pending migrations (قبل از اجرا):** ۵ مورد —
  - `20261108220000_m3a_charge_billing_credit`
  - `20261109010000_m3a_acceptance_remediation`
  - `20261109020000_m3a_final_acceptance_patch`
  - `20261110120000_m3b_payment_allocation_receipt`
  - `20261111000000_m3b_financial_immutability`
- **Receipt numeric count:** 0
- **Receipt legacy (non-numeric) count:** 0
- **Maximum historical numeric receipt:** — (هیچ ردیف payment وجود ندارد)
- **INT32 overflow count:** 0
- **Organizations affected (دارای رسید عددی):** 0
- **Preflight result:** PASS (تعداد کل `payments = 0`)
- **M3a پیش‌نیاز:** `charges = 0` (بدون RENT بدون‌contract و بدون RENT تکراری) → قیدهای M3a بدون برخورد.

---

## Backup و Rehearsal

- **Backup file (اول، قبل از Rehearsal):** `F:\eskan_backups\eskan_dev_20261111_113355.dump`
  - SHA-256: `F542F04310B4E9598BF3EAD9C0334E9C61BFE972C330F1324234BBC375D19034`
- **Backup file (نهایی، بلافاصله قبل از اجرای واقعی):** `F:\eskan_backups\eskan_dev_20261111_122607.dump`
  - SHA-256: `83A91FD11BD7D7033C711E8E9F247533E831AA71913BA12D3CEC1A36CFA2B15F`
- **Archive verification:** `pg_restore --list` موفق — 267 TOC entry، فرمت Custom (gzip)، dbname=`eskan_dev`.
- **Restore on clone:** موفق — clone `eskan_dev_m3b_rehearsal_20261111_113355`.
- **مقایسهٔ شمارش (۱۰ جدول + `_prisma_migrations`) پیش/پس از restore:** یکسان (72 org / 53 hostel / 43 room / 91 bed / 84 resident / 90 contract / 0 charge / 0 payment / 0 allocation / 72 user / `_prisma_migrations` 13).
- **Migration result on clone:** `prisma migrate deploy` موفق (۵ migration اعمال شد).
- **Postflight on clone:** 13/13 PASS + `migrate diff` خالی (parity).

---

## اجرای واقعی

- **Migrationهای Applied (روی `eskan_dev`):**
  1. `20261108220000_m3a_charge_billing_credit`
  2. `20261109010000_m3a_acceptance_remediation`
  3. `20261109020000_m3a_final_acceptance_patch`
  4. `20261110120000_m3b_payment_allocation_receipt`
  5. `20261111000000_m3b_financial_immutability`
- **فرمان واقعی:** `prisma migrate deploy` (datasource: PostgreSQL `eskan_dev` @ 127.0.0.1:5432).
- **Deploy result:** `All migrations have been successfully applied.` (exit 0)
- **Final `migrate status`:** `Database schema is up to date!` (exit 0)
- **Postflight result (اسکناد اصلی):** 13/13 PASS —
  - `payments.provisional_receipt_id` (text) موجود
  - `receipt_counters.counter` = integer (int32)
  - `allocation_releases` موجود
  - CHECK `allocation_releases_amount_positive` + `receipt_counters_counter_non_negative`
  - unique index `payment_allocations(organization_id, resident_id, id)`
  - FKهای `allocation_releases` (org / resident / allocation / actor)
  - FK `payment_allocations→payments` = `ON DELETE RESTRICT` (confdeltype=`r`)
  - ۳ Trigger `payments_prevent_delete` / `payment_allocations_prevent_delete` / `allocation_releases_prevent_delete` (enabled=`O`)
  - تابع `prevent_financial_document_delete()`
  - `receipt_counters` خالی (backfill no-op — هیچ رسید عددی تاریخی نبود)
  - `charges.entry_side` + قید/index های rent مربوط به M3a
  - `migrate diff` خالی (parity)

---

## محیط‌ها

| محیط | وضعیت |
|---|---|
| CI / Throwaway | Tested (سبز) |
| Rehearsal Clone | Done (clone `eskan_dev_m3b_rehearsal_20261111_113355`) |
| eskan_dev | **Applied** |
| Staging | Not Applied |
| Production | Not Applied |

---

## ریسک‌ها و اقدامات باقی‌مانده

- **موارد حل‌نشده:** هیچ — پیش از اجرای واقعی، Preflight رسید هیچ دادهٔ پرداختی موجود نداشت (پس Backfill/Overflow عملاً بدون داده بود). محدودیت INT32 شمارنده همچنان به‌عنوان تصمیم ثبت‌شده باقی است و باید در آینده هنگام ورود دادهٔ مالی واقعی دوباره مدنظر باشد.
- **Backup/Recovery location:** `F:\eskan_backups\` (خارج از مخزن؛ فایل Backup هرگز در Git قرار نمی‌گیرد).
- **اقدام بعدی:** —
- **تأکید:** هیچ Migration روی Staging یا Production اعمال نشده است.