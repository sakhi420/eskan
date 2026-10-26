# سناریوهای پذیرش — اسکان (ESKAN)

هر سناریو با Given/When/Then مشخص است و test مرتبط دارد.

## AS-001 ثبت مالک و سازمان
- G: ثبت آزاد فعال. W: register با email/رمز/نام سازمان. T: user+org+OWNER ساخته می‌شود.
- G: ثبت آزاد غیرفعال. T: 403 `REGISTRATION_DISABLED`.

## AS-002 نشست و refresh
- W: login صحیح. T: access+refresh برگردد.
- W: refresh با token صحیح. T: token جدید + چرخش؛ token قبلی از کار بیفتد.
- W: reuse refresh. T: revoke خاندان و 401.
- W: logout. T: نشست revoke؛ logout-all همه را revoke.

## AS-003 سازمان و اعضا
- W: OWNER نقش عضو را تغییر دهد. T: مجاز.
- W: تنزل/حذف آخرین OWNER. T: 409/BUSINESS_RULE_VIOLATION.

## AS-004 لیلیه/اتاق/بستر
- W: کد اتاق تکراری در یک لیلیه. T: 409 duplicate.
- W: archive اتاق دارای assignment فعال. T: 409.
- W: جست‌وجو/صفحه‌بندی. T: items/page/total منطبق.

## AS-005 ساکن
- W: ثبت با نوع STUDENT. T: ساکن ساخته شود؛ PII حداقل.

## AS-006 قرارداد
- W: transition DRAFT→ACTIVE. T: مجاز.
- W: activate قرارداد بدون بستر. T: مجاز (تخصیص جدا).
- W: ویرایش قرارداد ACTIVE در حالت قطعی. T: policy-limited.

## AS-007 تخصیص بستر
- W: دو تخصیص overlap برای یک بستر. T: 409 BED_ASSIGNMENT_OVERLAP.
- W: دو درخواست هم‌زمان همان بستر. T: یک موفق + یک conflict.
- W: end assignment دوباره. T: idempotent/conflict-safe.

## AS-008 مالی (سناریوی اجباری)
1. charge 10000 AFN → مانده 10000.
2. payment 4000 allocate → مانده 6000.
3. payment 3000 allocate → مانده 3000.
4. allocate 4000 از payment 3000 → رد.
5. همان idempotency key → پرداخت تازه نسازد.
6. همان key با body متفاوت → 409 IDEMPOTENCY_KEY_REUSED.
7. reversal با دلیل → سابقه بماند؛ مانده دوباره محاسبه شود.
9. دو allocation هم‌زمان > amount → رد.
10. org A نتواند payment/charge org B را allocate کند.

## AS-009 ودیعه
- W: برگشت بیش از مانده. T: 409 DEPOSIT_BALANCE_INSUFFICIENT.
- W: RECEIVED 5000. T: مانده ودیعه 5000 و در گزارش کرایه ادغام نشود.

## AS-010 هزینه
- W: ثبت و reversal. T: سابقه اصلی بماند؛ گزارش منعکس شود.

## AS-011 حساب ساکن
- W: GET account. T: بدهی/دریافت‌ها/ودیعه مطابق ledger.

## AS-012 گزارش
- W: گزارش با مجموعهٔ دادهٔ مشخص. T: با query مستقل/oracle برابر باشد.

## AS-013 audit
- W: عملیات حساس. T: رویداد audit ثبت؛ کاربر عادی نتواند آن را تغییر دهد.

## AS-014 sync pull
- W: تغییرات با cursor صفحه‌به‌صفحه. T: بدون skip؛ nextCursor/hasMore.
- W: cursor خیلی قدیمی. T: SYNC_RESYNC_REQUIRED.
- W: tombstone برای archive. T: کلاینت نامرئی نکند.

## AS-015 idempotency/تعارض
- W: retry همان key+payload. T: همان logical result.
- W: نسخهٔ قدیمی update. T: 409 RESOURCE_VERSION_CONFLICT.

## AS-016 جداسازی سازمان
- W: org B به resident/charge org A. T: 404 (یا 403) — بدون نشت.

## AS-017 (SHOULD) ترمیمات
- W: ایجاد و transition open→in_progress→resolved. T: فقط transition مجاز.

## AS-018 (SHOULD) دعوت عضو
- W: OWNER دعوت با توکن یک‌بارمصرف. T: عضو با نقش مشخص joins.