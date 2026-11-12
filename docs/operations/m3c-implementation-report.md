# ESKAN M3c — Implementation Report

**Status:** IMPLEMENTED ON FEATURE BRANCH — LOCAL VALIDATION AND CI STILL REQUIRED
**Date:** 2026-11-12

## Git
- Branch: `feat/m3c-deposit-expense-refund-reversal`
- Base SHA: `506947b2ac6f475f5c9418dfb640af5c9719bb10` (= `origin/main`)
- Local working tree: not inspected by this GitHub-side patch; pull the branch to update the local clone
- PR: not created; the feature branch is pushed and awaits owner-side local validation.

## Scope
| قابلیت | وضعیت | شواهد |
|---|---|---|
| Deposit Receive | ✅ runtime | `src/deposits/deposits.service.ts` `receive()` + integration |
| Deposit Refund | ✅ runtime | `refund()` with `REFUND_EXCEEDS_DEPOSIT_BALANCE` + concurrency |
| Deposit Forfeit | ✅ runtime | `forfeit()` with `DEPOSIT_BALANCE_INSUFFICIENT` + concurrency |
| Deposit Application | ✅ runtime | `apply()` → non-cash DEPOSIT_APPLICATION Payment + Allocation + DepositApplication |
| Expense | ✅ runtime | `src/expenses/` create/get/list/reverse |
| Payment Refund | ✅ runtime | `payments.refundPayment()` |
| Void/Reversal | ✅ runtime | charge/payment/deposit/expense full void + `LedgerReversal` |
| Audit/Sync integration | ✅ runtime | every mutation emits AuditEvent + SyncChange atomically |

## Database
- Models added: `LedgerReversal`, `PaymentRefund`, `DepositApplication`
- Models changed: `DepositTransaction` (+`actorUserId`, composite uniques), `Expense` (+`actorUserId`), `Payment` (`receiptNumber` → nullable)
- Enums: `PaymentMethod` + `DEPOSIT_APPLICATION`; new `ReversalSourceType`
- Migration: `20261112000000_m3c_deposit_refund_expense_reversal`
- Constraints: `amount > 0` CHECKs on the 3 new tables
- Tenant FKs: 6 new composite FKs (composite count 24 → 30)
- Triggers: 5 new `*_prevent_delete` triggers (reuse `prevent_financial_document_delete`)
- Prisma parity: `prisma migrate diff` empty (verified in migration test)
- Actual environments migrated: **none** (CI/throwaway only)

## API
- Endpoints added (runtime): `GET/POST /residents/{id}/deposit-transactions`, `POST /residents/{id}/deposits/apply`,
  `POST /deposit-transactions/{id}/{reverse,refund,forfeit}`, `GET/POST /expenses`, `GET /expenses/{id}`,
  `POST /expenses/{id}/reverse`, `POST /payments/{id}/{refund,reverse}`, `POST /charges/{id}/reverse`
- Permissions: matching `docs/api/permissions-matrix.md` (OWNER/ADMIN for sensitive; OWNER/ADMIN/OPERATOR for daily)
- OpenAPI: `PaymentMethod.DEPOSIT_APPLICATION` + error codes added; `receiptNumber` optional in `Payment`; lint exit 0

## Tests

The counts/results below are historical for the earlier M3c implementation and do not verify
the additional remediation commits now on this branch.

- Historical integration source files: deposit/refund/reversal, concurrency and reconciliation.
- Current source inventory: 33 integration cases (20 + 4 + 1 + 8); not yet executed after this patch.
- The migration script now includes a separate pre-M3c baseline upgrade rehearsal with M3b
  financial rows, plus fresh replay and additional DAPP/append-only constraints.
- Build, Prisma, OpenAPI, lint, format, unit, integration and migration gates must be rerun
  against the current branch head. CI has not been verified.

## Remaining acceptance gaps
- P1: HTTP/Supertest tests for the OWNER/ADMIN/OPERATOR/VIEWER permission matrix and
  cross-tenant/BOLA denial are still outstanding.
- CI has not run on the current branch head; lint/format gates were added to the workflow.
- The current branch's new baseline-upgrade migration path and tests must be executed locally.
- Do not apply M3c migrations to `eskan_dev`, Staging or Production before independent review.

## Environment boundary
- CI/Throwaway: migrations + tests exercised (throwaway DBs)
- Clone: not run (optional)
- eskan_dev: **not migrated**
- Staging: **not migrated**
- Production: **not migrated**

## Next step
- Owner review; PR approval; merge only with independent owner decision.