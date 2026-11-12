# ESKAN M3c — Implementation Report

**Status:** PASS (code + schema + migration + tests complete; PR submitted, NOT merged)
**Date:** 2026-11-12

## Git
- Branch: `feat/m3c-deposit-expense-refund-reversal`
- Base SHA: `506947b2ac6f475f5c9418dfb640af5c9719bb10` (= `origin/main`)
- Working tree: clean at completion (committed)
- PR URL: (to be created against `main`)

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
- Unit: existing suite green
- Integration: `m3c-deposits-refund-reversal` (15), `m3c-concurrency` (4), `m3c-reconciliation` (1) — all PASS
- Migration: `scripts/test-m3c-migration.cjs` — 29/29 PASS (fresh DB, CHECKs, tenant FKs, delete protection, parity)
- Concurrency: barrier-based races (refund/forfeit/apply over balance + refund-vs-forfeit) PASS
- Reconciliation: independent raw-SQL oracle for Deposit Held + non-cash payment assertion PASS
- Build: `npm run build` exit 0
- CI: wired (`ci.yml` M3c migration step; integration auto-discovered)

## Remaining risks
- P0: none
- P1: none identified
- P2: "final checkout" gate interpreted as "no ACTIVE contract" (documented in ADR-0011 §5)
- Unresolved product decisions: none (D-01..D-18 fully honored)

## Environment boundary
- CI/Throwaway: migrations + tests exercised (throwaway DBs)
- Clone: not run (optional)
- eskan_dev: **not migrated**
- Staging: **not migrated**
- Production: **not migrated**

## Next step
- Owner review; PR approval; merge only with independent owner decision.