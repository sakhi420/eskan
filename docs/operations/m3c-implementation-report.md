# ESKAN M3c — Implementation Report

**Status:** IMPLEMENTED; CURRENT-HEAD CI VERIFIED INCLUDING DAPP/CHARGE REVERSAL ORDER; HIGH/CRITICAL AUDIT GATE PASSES; HUMAN REVIEW/OWNER APPROVAL PENDING  
**Date:** 2026-11-12

## Git / PR
- Branch: `feat/m3c-deposit-expense-refund-reversal`
- Base: `main` at `506947b2ac6f475f5c9418dfb640af5c9719bb10`
- Verified implementation head: `dfe84d32b10a92fd5df638bd24033fa0944d4a62`
- PR: [#5](https://github.com/sakhi420/eskan/pull/5) — Draft, open, not merged.
- CI: [Run #92 — success](https://github.com/sakhi420/eskan/actions/runs/43275631701).
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
- A single source-balance cap is enforced at the database layer across active REFUNDED/FORFEITED events and POSTED DepositApplications. The source RECEIVED row is locked before aggregate validation, and mixed consumption cannot exceed the original received amount.
- A Charge cannot be reversed while a linked DepositApplication remains POSTED. Both service logic and a database trigger enforce the rule; the application must be reversed first to restore Deposit Held and release its DAPP allocation.
- A DAPP Payment cannot be reversed independently, and an Application cannot be marked REVERSED unless its linked Payment is REVERSED, the exact full AllocationRelease has been written, exactly one matching DEBIT LedgerReversal exists, and the Charge remains POSTED. A deferred constraint trigger verifies Payment/Application consistency at commit. The service now writes the compensating event and full release before the two status transitions.
- Prisma parity assertions passed.
- Dependency lockfile upgrades `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, and `@nestjs/testing` to 12.5.0 and pins transitive `multer` at 2.5.0; current lockfile was tested using ordinary `npm ci`.
- `npm audit --audit-level=high`: PASS (0 High / 0 Critical). Remaining `npm audit`: 29 findings (4 Low / 25 Moderate), predominantly development/test dependency chains; not yet fully triaged.
- The remaining findings are in the development/test dependency tree, not the production dependency set: `glob@13.0.7` is used by Jest reporters/config/runtime, while `glob@10.5.0` is nested below `test-exclude`; `minimatch@10.2.6` is used by ESLint/TypeScript-ESLint and the glob chain, and `minimatch@9.0.9` is nested below `test-exclude`; `deepmerge@4.3.1` is pulled by `jest-config`.
- Upstream advisories list `glob` as affected through 14.0.1 (fixed in 14.0.2) and `minimatch` as affected below 11.0.1. Current parents request incompatible major ranges (`glob@^13`, `glob@^10`, `minimatch@^10`, and `minimatch@^9`); a root override would force major-version mismatches rather than a safe patch update. The `deepmerge` advisory currently lists no patched release. These findings remain open and are not counted as fixed.
- Persistent environments actually migrated: **none**.

## Current-head CI evidence

All results below are from SHA `dfe84d32b10a92fd5df638bd24033fa0944d4a62`:
- `npm ci` using the committed lockfile, `npm audit --audit-level=high`, Build, ESLint, Prettier, OpenAPI validation and Prisma validation: PASS.
- Unit tests: 12 suites / 79 tests.
- E2E smoke tests: 4 suites / 29 tests, including the new P1-7 HTTP role/BOLA suite.
- M3a: 11/11 migration checks.
- M3b: 30/30 migration checks.
- M3c: 83/83 migration checks.
- PostgreSQL integration: 13 suites / 139 tests, including DAPP-first / Charge-second reversal ordering and the real `reverseApplication()` transaction.
- M-1/M-2 checks, package/hostel concurrency, M-2 parity and idempotency-retention checks: PASS.

## Remaining release gates
- PR #5 stays Draft and unmerged pending independent human review and explicit owner approval.
- Triage the remaining 29 npm audit findings (4 low, 25 moderate); the two High Multer-chain findings were addressed by the lockfile update. Avoid blind `npm audit fix --force`.
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
