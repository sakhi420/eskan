# ESKAN M3c — Implementation Report

**Status:** IMPLEMENTED; CURRENT-HEAD CI VERIFIED; HUMAN REVIEW/OWNER APPROVAL PENDING  
**Date:** 2026-11-12

## Git / PR
- Branch: `feat/m3c-deposit-expense-refund-reversal`
- Base: `main` at `506947b2ac6f475f5c9418dfb640af5c9719bb10`
- Verified head: `6601c038a717d5b0d2daa58430a4df69eb604687`
- PR: [#5](https://github.com/sakhi420/eskan/pull/5) — Draft, open, not merged.
- CI: [Run #67 — success](https://github.com/sakhi420/eskan/actions/runs/43266432493).
- Local working tree was not inspected by this GitHub-side review. Pull the branch before continuing local work.

## Scope
| قابلیت | وضعیت | شواهد |
|---|---|---|
| Deposit Receive / Refund / Forfeit | ✅ runtime | Deposit service + current PostgreSQL integration and M3c DB checks |
| Deposit Application | ✅ runtime | Internal DAPP Payment + exact one Allocation + DepositApplication; dedicated reversal |
| Expense | ✅ runtime | Create/get/list/reverse; paid-only manual method |
| Payment Refund | ✅ runtime | Separate real-cash refund path |
| Void / Reversal | ✅ runtime | Full reversal events for Charge/Payment/Deposit/Expense |
| Audit / Sync | ✅ runtime | Financial mutations emit AuditEvent + SyncChange transactionally |
| Tenant isolation | ✅ verified | Composite FKs plus current HTTP BOLA tests |
| Authorization | ✅ verified | OWNER/ADMIN/OPERATOR/VIEWER HTTP role matrix; P1-7 closed |

## Database and migration integrity
- Models: `LedgerReversal`, `PaymentRefund`, `DepositApplication`.
- Changed models: `DepositTransaction` and `Expense` actor attribution; `Payment.receiptNumber` nullable only to support internal DAPP.
- Migrations:
  - `20261112000000_m3c_deposit_refund_expense_reversal`
  - `20261112120000_m3c_dapp_reversal_and_deposit_source`
- Nine M3c-owned tenant composite FKs are asserted by their constraint names.
- DAPP has explicit source-deposit, Payment, Allocation and Charge links. Its linked Payment must have method `DEPOSIT_APPLICATION`, no receipt, exact amount, and exactly one full allocation.
- Ordinary payment methods require an official receipt number.
- Refund and LedgerReversal records are append-only at the database layer. Expense financial identity cannot be rewritten; reversal metadata remains mutable.
- Deposit/Expense actor-user references use RESTRICT to preserve audit attribution.
- M3c fresh replay and pre-M3c baseline upgrade rehearsal both passed in throwaway CI databases.
- A legacy-data rehearsal confirmed that an unmapped pre-M3c REFUNDED/FORFEITED event aborts the FIRST M3c migration before any schema change; the test confirms no partial M3c enum/table/column artifacts remain.
- PostgreSQL triggers enforce source-deposit semantics and require DAPP to use an unreversed POSTED RECEIVED deposit and a POSTED DEBIT charge.
- Prisma parity assertions passed.
- Persistent environments actually migrated: **none**.

## Current-head CI evidence

All results below are from SHA `6601c038a717d5b0d2daa58430a4df69eb604687`:
- Build, ESLint, Prettier, OpenAPI validation and Prisma validation: PASS.
- Unit tests: 12 suites / 79 tests.
- E2E smoke tests: 4 suites / 29 tests, including the new P1-7 HTTP role/BOLA suite.
- M3a: 11/11 migration checks.
- M3b: 30/30 migration checks.
- M3c: 67/67 migration checks.
- PostgreSQL integration: 13 suites / 139 tests.
- M-1/M-2 checks, package/hostel concurrency, M-2 parity and idempotency-retention checks: PASS.

## Remaining release gates
- PR #5 stays Draft and unmerged pending independent human review and explicit owner approval.
- Triage the 32 npm audit findings previously reported (4 low, 26 moderate, 2 high); avoid blind `npm audit fix --force`.
- Approve backups, restore rehearsal and staged migration rollout before any persistent environment is migrated.
- Automated Sourcery review skipped the PR because the diff exceeds its 20,000 changed-line limit; this does not affect the green CI result.

## Environment boundary
- GitHub Actions: current-head migration and test gates passed using disposable PostgreSQL databases.
- Local clone: not inspected or changed by this GitHub-side review.
- `eskan_dev`: **not migrated by this work**.
- Staging: **not migrated**.
- Production: **not migrated**.

## Next step
Independent human review of financial migrations and domain invariants, then owner decision on PR #5. Do not merge or apply M3c to a persistent database before those gates.
