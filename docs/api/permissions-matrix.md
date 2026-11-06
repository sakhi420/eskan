# ماتریس مجوزها — ESKAN

نقش‌های سازمانی: `OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`.
نقش جداگانهٔ پلتفرم: `PLATFORM_ADMIN` — فقط مسیرهای `/api/v1/admin/**`؛ مستقل از نقش‌های سازمانی است و در جدول زیر نمی‌آید.

## ماتریس path + method (منبع مرجع مجوزها)

### عملیات محدودشده (نوشتنی و state-transition)

| Method + Path | operationId | دسترسی مجاز (نقش) |
|---|---|---|
| PATCH /organizations/current | organizationPatchCurrent | OWNER |
| PATCH /organizations/current/members/{membershipId} | organizationPatchMember | OWNER |
| POST /hostels | hostelCreate | OWNER, ADMIN |
| PATCH /hostels/{hostelId} | hostelUpdate | OWNER, ADMIN |
| POST /hostels/{hostelId}/archive | hostelArchive | OWNER, ADMIN |
| POST /hostels/{hostelId}/rooms | roomCreate | OWNER, ADMIN |
| PATCH /rooms/{roomId} | roomUpdate | OWNER, ADMIN |
| POST /rooms/{roomId}/archive | roomArchive | OWNER, ADMIN |
| POST /rooms/{roomId}/beds | bedCreate | OWNER, ADMIN |
| PATCH /beds/{bedId} | bedUpdate | OWNER, ADMIN |
| POST /beds/{bedId}/deactivate | bedDeactivate | OWNER, ADMIN |
| POST /hostels/{hostelId}/packages | packageCreate | OWNER, ADMIN |
| PATCH /packages/{packageId} | packageUpdate | OWNER, ADMIN |
| POST /packages/{packageId}/archive | packageArchive | OWNER, ADMIN |
| POST /residents | residentCreate | OWNER, ADMIN, OPERATOR |
| PATCH /residents/{residentId} | residentUpdate | OWNER, ADMIN |
| POST /residents/{residentId}/archive | residentArchive | OWNER, ADMIN |
| POST /contracts | contractCreate | OWNER, ADMIN, OPERATOR |
| PATCH /contracts/{contractId} | contractUpdate | OWNER, ADMIN, OPERATOR |
| POST /contracts/{contractId}/activate | contractActivate | OWNER, ADMIN, OPERATOR |
| POST /contracts/{contractId}/terminate | contractTerminate | OWNER, ADMIN, OPERATOR |
| POST /contracts/{contractId}/checkout | contractCheckout | OWNER, ADMIN, OPERATOR |
| POST /bed-assignments | assignmentCreate | OWNER, ADMIN, OPERATOR |
| POST /bed-assignments/{assignmentId}/end | assignmentEnd | OWNER, ADMIN, OPERATOR |
| POST /bed-assignments/{assignmentId}/transfer | assignmentTransfer | OWNER, ADMIN, OPERATOR |
| POST /organizations/current/members/invitations | invitationCreate | OWNER |
| POST /organizations/current/members/invitations/{invitationId}/revoke | invitationRevoke | OWNER |
| POST /charges | chargeCreate | DEBIT: OWNER/ADMIN/OPERATOR · CREDIT: OWNER/ADMIN |
| POST /charges/{chargeId}/reverse | chargeReverse | OWNER, ADMIN |
| POST /payments | paymentCreate | OWNER, ADMIN, OPERATOR |
| POST /payments/{paymentId}/allocations | allocationCreate | OWNER, ADMIN, OPERATOR |
| POST /allocations/{allocationId}/release | allocationRelease | OWNER, ADMIN |
| POST /payments/{paymentId}/reverse | paymentReverse | OWNER, ADMIN |
| POST /payments/{paymentId}/refund | paymentRefund | OWNER, ADMIN |
| POST /residents/{residentId}/deposit-transactions | depositCreate | OWNER, ADMIN, OPERATOR |
| POST /deposit-transactions/{depositTransactionId}/reverse | depositReverse | OWNER, ADMIN |
| POST /deposit-transactions/{depositTransactionId}/refund | depositRefund | OWNER, ADMIN |
| POST /deposit-transactions/{depositTransactionId}/forfeit | depositForfeit | OWNER, ADMIN |
| POST /residents/{residentId}/deposits/apply | depositApply | OWNER, ADMIN |
| POST /expenses | expenseCreate | OWNER, ADMIN, OPERATOR |
| POST /expenses/{expenseId}/reverse | expenseReverse | OWNER, ADMIN |
| POST /billing-runs | billingRunPost | OWNER, ADMIN |
| POST /residents/{residentId}/absences | absenceCreate | OWNER, ADMIN, OPERATOR |
| PATCH /absences/{absenceId} | absenceUpdate | OWNER, ADMIN, OPERATOR |
| POST /absences/{absenceId}/credits | absenceCreditGenerate | OWNER, ADMIN |

### Platform Admin (`/api/v1/admin/**`) — فقط PLATFORM_ADMIN

| Method + Path | operationId |
|---|---|
| GET /admin/organizations | adminOrganizationList |
| GET /admin/organizations/{organizationId}/subscription | adminSubscriptionGet |
| GET /admin/organizations/{organizationId}/subscription/history | adminSubscriptionHistory |
| POST /admin/organizations/{organizationId}/subscription/activate | adminSubscriptionActivate |
| POST /admin/organizations/{organizationId}/subscription/extend | adminSubscriptionExtend |
| POST /admin/organizations/{organizationId}/subscription/change-plan | adminSubscriptionChangePlan |
| POST /admin/organizations/{organizationId}/subscription/suspend | adminSubscriptionSuspend |
| POST /admin/organizations/{organizationId}/subscription/resume | adminSubscriptionResume |
| POST /admin/organizations/{organizationId}/subscription/grant-grace | adminSubscriptionGrantGrace |
| POST /admin/organizations/{organizationId}/subscription/payments | adminSubscriptionPayment |

### طبقه‌بندی کامل دسترسی — هماهنگ با security واقعی OpenAPI

هر ۱۱۳ عملیات OpenAPI (۱۱۱ عملیات محصول + ۲ health probe) دقیقاً در یکی از این ۵ کلاس می‌گنجد. ستون «security» وضعیت واقعی قرارداد است: `empty` = `security: []`، `bearer` = `security: [{ bearerAuth: [] }]`، `inherit` = bearer + `X-Organization-Id` (امنیت پیش‌فرض سراسری).

توزیع محصولی (۱۱۱): Anonymous ۶ · احراز-بدون-نقش ۶ · عضو-هر-نقش ۴۴ · محدود-نقش ۴۵ · Platform Admin ۱۰.

#### کلاس ۱ — Anonymous / عمومی (`security: []`)

| Method + Path | operationId |
|---|---|
| GET /health/live | healthLive |
| GET /health/ready | healthReady |
| GET /system/version | systemVersion |
| POST /auth/register | authRegister |
| POST /auth/login | authLogin |
| POST /auth/refresh | authRefresh |
| POST /invitations/accept | invitationAccept |
| GET /plans | planList |

> `POST /invitations/accept` توکن یک‌بارمصرف دارد؛ دعوت‌شونده هنوز وارد نشده، پس `security: []` است (بدون bearer/X-Org). توکن معتبر همچنان شرط دسترسی است.

#### کلاس ۲ — احراز هویت‌شده، بدون نقش سازمانی (`security: [{ bearerAuth: [] }]`)

| Method + Path | operationId |
|---|---|
| GET /system/me | systemMe |
| GET /auth/me | authMe |
| POST /auth/logout | authLogout |
| POST /auth/logout-all | authLogoutAll |
| POST /auth/change-password | authChangePassword |
| GET /organizations | organizationListMine |

> این‌ها فقط bearerAuth لازم دارند و `X-Organization-Id` لازم ندارند؛ از endpointهای anonymous جدا هستند و «بدون نقش سازمانی» با «بدون احراز هویت» یکی نیست. `GET /organizations` همین‌جا قرار دارد چون وظیفه‌اش فهرست‌کردن عضویت‌ها/سازمان‌های کاربر برای انتخاب سازمان فعال است؛ اگر `X-Organization-Id` می‌خواست، انتخاب سازمان ناممکن می‌شد.

#### کلاس ۳ — عضو سازمانی با هر نقش (OWNER/ADMIN/OPERATOR/VIEWER)

- همهٔ GET‌های منابع سازمانی (hostels/rooms/beds/packages/residents/contracts/bed-assignments/charges/payments/allocations/deposits/expenses/absences/billing-runs/ledger/reports/subscription/sync) که در کلاس ۱/۲/۵ نیستند → هر نقش.
- به‌صورت صریح (زیرا روی «منبع» واضحی قرار ندارند):
  - `GET /organizations/current` → `organizationGetCurrent`
  - `GET /organizations/current/members` → `organizationListMembers`
  - `GET /organizations/current/members/invitations` → `invitationList`
- نوشتنی بدون محدودیت نقش:
  - `POST /billing-runs/preview` → `billingRunPreview` (read-only منطقی)
  - `POST /sync/devices/register` → `syncRegisterDevice`
  - `POST /sync/resync-request` → `syncResyncRequest`
- عدم عضویت در سازمانِ درخواستی → **404** نه **403**.

#### کلاس ۴ — عملیات محدود به نقش (جدول «عملیات محدودشده» بالا)

۴۵ ردیف جدول بالا؛ enforcement سمت سرور؛ عضویت بدون نقش کافی → **403**.

#### کلاس ۵ — Platform Admin (`/api/v1/admin/**`)

جدول Platform Admin بالا؛ فقط `PLATFORM_ADMIN` (`User.isPlatformAdmin`)؛ عدم دسترسی → **404**/نقش ناکافی → **403**. security فقط `[{ bearerAuth: [] }]` است؛ `X-Organization-Id` برای این مسیرها **الزامی نیست** (مدیر پلتفرم الزاماً عضو سازمانِ هدف نیست و `organizationId` در مسیر، سازمانِ هدفِ عملیات است نه انتخاب سازمان).

## Platform Admin (`/api/v1/admin/**`)

- فقط `PLATFORM_ADMIN`؛ هیچ‌یک از نقش‌های سازمانی (حتی OWNER) به این مسیرها دسترسی ندارند.
- عملیات: list/get/history + activate/extend/change-plan/suspend/resume/grant-grace/payments.
- **منبع authority قطعی:** `User.isPlatformAdmin` (Boolean). اگر JWT claim استفاده شود، باید از همین مقدار سمت سرور مشتق شود؛ claim و ستون DB نباید دو منبع مستقل/قابل‌تعارض باشند. `OWNER` سازمانی به‌طور خودکار `PLATFORM_ADMIN` نیست.
- عدم عضویت/منبع → **404**؛ نقش ناکافی → **403**.

## سیاست cross-tenant و خطاها

- `organizationId` همیشه از security context؛ هرگز از body/query.
- عدم عضویت در سازمانِ درخواستی → **404** (نه 403) برای جلوگیری از افشای وجود منبع.
- عضویت دارد ولی نقش کافی ندارد → **403** `FORBIDDEN`/`INSUFFICIENT_ROLE`.
- همهٔ enforcement سمت سرور؛ مخفی‌کردن دکمه در UI مجوز نیست.

## نکات

- آخرین OWNER قابل حذف/تنزل نیست (409).
- نقش‌های مالی حساس (refund/forfeit/apply/reversal/credit/صدور قطعی کرایه) فقط OWNER/ADMIN.