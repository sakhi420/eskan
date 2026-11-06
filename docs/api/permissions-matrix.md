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
| POST /sync/devices/register | syncRegisterDevice | عضو authenticated |
| POST /sync/resync-request | syncResyncRequest | عضو authenticated |

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

### خواندنی و عمومی

- همهٔ GETهای سازمانی (hostels/rooms/beds/packages/residents/contracts/assignments/charges/payments/deposits/expenses/reports/sync/plans/subscription/me) → عضو authenticated با هر نقش (OWNER/ADMIN/OPERATOR/VIEWER).
- Billing preview (POST /billing-runs/preview) → عضو authenticated (read-only).
- Auth (register/login/refresh/logout/logout-all/me/change-password) و POST /invitations/accept → عمومی/توکنی، بدون نقش سازمانی.
- GETهای `/admin/**` → PLATFORM_ADMIN (جدول بالا).

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