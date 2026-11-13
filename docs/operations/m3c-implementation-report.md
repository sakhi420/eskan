# ESKAN M3c — Implementation Report

**Status:** PR HEAD CI VERIFIED — M3c MIGRATION / HTTP / INTEGRATION GATES PASS; DEPENDENCY FINDINGS TRIAGED BUT UNPATCHED; INDEPENDENT REVIEW, BACKUP/RESTORE APPROVAL, AND OWNER DECISION PENDING  
**Date:** 2026-11-13

## Git / PR
- Branch: `feat/m3c-deposit-expense-refund-reversal`
- Base: `main` at `506947b2ac6f475f5c9418dfb640af5c9719bb10`
- Last PR head covered by a full CI run (Run #102): `787809e663d982cca58d1e61f95ac84a9a3a9999`. Documentation-only review/report updates were committed afterward; no runtime source, schema, migration, contract, or test files changed in those follow-up commits.
- Code-bearing implementation head: `3def75aab45c9080fccb889b2e8f96a4fc7418e7`.
- PR: [#5](https://github.com/sakhi420/eskan/pull/5) — Draft, open, not merged.
- Last recorded full CI: [Run #102 — success](https://github.com/sakhi420/eskan/actions/runs/43278611645), executed on PR head `787809e...` at the time of that run.
- Run #101 verified the last code-bearing implementation head; Run #102 repeated the full workflow on exact PR head `787809e...` at the time of that run.
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
- `ledger_reversals_validate_deposit_source` validates every DEPOSIT reversal at INSERT. A RECEIVED reversal is rejected while active child events or applications exist; child reversal is rejected once its parent RECEIVED row is reversed. `ledger_reversals_deposit_source_unique` allows at most one DEPOSIT reversal per source.
- A Charge cannot be reversed while a linked DepositApplication remains POSTED. Both service logic and a database trigger enforce the rule; the application must be reversed first to restore Deposit Held and release its DAPP allocation.
- A DAPP Payment cannot be reversed independently, and an Application cannot be marked REVERSED unless its linked Payment is REVERSED, the exact full AllocationRelease has been written, exactly one matching DEBIT LedgerReversal exists, and the Charge remains POSTED. A deferred constraint trigger verifies Payment/Application consistency at commit. The service writes the compensating event and full release before the two status transitions.
- `AllocationRelease` INSERT is also guarded: normal releases cannot exceed their allocation; DAPP releases require the matching DEBIT LedgerReversal and reversed internal Payment, and must bring the release total exactly to the application amount.
- Prisma parity assertions passed.
- Dependency lockfile upgrades `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, and `@nestjs/testing` to 12.5.0 and pins transitive `multer` at 2.5.0; current lockfile was tested using ordinary `npm ci`.
- `npm audit --audit-level=high`: PASS (0 High / 0 Critical). Remaining `npm audit`: 29 findings (4 Low / 25 Moderate), predominantly development/test dependency chains; not yet fully triaged.
- The remaining findings are in the development/test dependency tree, not the production dependency set: `glob@13.0.7` is used by Jest reporters/config/runtime, while `glob@10.5.0` is nested below `test-exclude`; `minimatch@10.2.6` is used by ESLint/TypeScript-ESLint and the glob chain, and `minimatch@9.0.9` is nested below `test-exclude`; `deepmerge@4.3.1` is pulled by `jest-config`.
### Dependency audit disposition — 2026-11-13

The recorded full audit contains **29 findings (4 Low, 25 Moderate, 0 High, 0 Critical)**. Inspection of the exact committed lockfile shows the affected package instances are development/test dependencies (\`dev: true\`), not direct production dependencies:

| Package instance(s) in lockfile | Advisory and fixed release | Constraint / disposition |
|---|---|---|
| \`glob@13.0.7\`, \`glob@10.5.0\` | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4); fixed in \`14.0.2\` | Current parents require \`^13\` and \`^10\`; no compatible patched release within those ranges. |
| \`minimatch@10.2.6\`, \`minimatch@9.0.9\` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249); fixed in \`11.0.1\` | Current parents require \`^10\` and \`^9\`; no compatible patched release within those ranges. |
| \`deepmerge@4.3.1\` | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | The reviewed advisory lists no patched release. |

**Triage result:** the remaining findings are classified as development/test-tooling exposure; they are **not fixed** and must not be reported as remediated. A blanket root override or \`npm audit fix --force\` is rejected because it would cross parent major-version ranges and can destabilize the build/test toolchain. Revisit when upstream parent packages support patched versions. The CI security gate remains \`npm audit --audit-level=high\` and passed with zero High/Critical findings; that gate does not clear the 29 Low/Moderate findings.

**Residual risk acceptance:** the project owner must explicitly accept this documented development-tooling risk for the PR, or defer merge until compatible upstream upgrades are available.
- Persistent environments actually migrated: **none**.

## Current-head CI evidence

All results below are from SHA `3def75aab45c9080fccb889b2e8f96a4fc7418e7`:
- `npm ci` using the committed lockfile, `npm audit --audit-level=high`, Build, ESLint, Prettier, OpenAPI validation and Prisma validation: PASS.
- Unit tests: 12 suites / 79 tests.
- E2E smoke tests: 4 suites / 29 tests, including the new P1-7 HTTP role/BOLA suite.
- M3a: 11/11 migration checks.
- M3b: 30/30 migration checks.
- M3c: 99/99 migration checks.
- PostgreSQL integration: 13 suites / 139 tests, including DAPP-first / Charge-second and source-deposit reversal ordering through the real services.
- M-1/M-2 checks, package/hostel concurrency, M-2 parity and idempotency-retention checks: PASS.

## Remaining release gates
- A second person must independently review both M3c migrations and the financial invariants. CI and this preparation review are not substitutes for that independent approval.
- Complete and record the backup/restore rehearsal on a controlled clone, then approve a staged migration plan before any persistent environment is migrated.
- The owner must explicitly accept the 29 unpatched Low/Moderate development-tooling findings or defer merge pending compatible upstream fixes.
- The owner must approve removing Draft status and merging only after the review and operational gates above are satisfied.
- Automated Sourcery review skipped the PR because the diff exceeds its 20,000 changed-line limit; this is not a CI failure.

## Environment boundary
- GitHub Actions: current-head migration and test gates passed using disposable PostgreSQL databases.
- Local clone: not inspected or changed by this GitHub-side review.
- `eskan_dev`: **not migrated by this work**.
- Staging: **not migrated**.
- Production: **not migrated**.

## Focus points for the independent reviewer

- Confirm whether the database must enforce the reverse existence invariant that every committed \`DEPOSIT_APPLICATION\` Payment has exactly one matching DepositApplication. The application insert checks the Payment/Allocation links, and the public service path creates all linked records atomically; explicitly decide whether an orphan internal Payment must also be impossible through direct database writes.
- Confirm the intended treatment of nullable \`actor_user_id\` on legacy-compatible DepositTransaction/Expense columns: application service writes set the authenticated actor, while historical rows may remain NULL. Decide whether an insert-time database guard is required for new direct writes.
- Re-check migration rollback/failure behavior, especially the first-migration legacy preflight, source-deposit row locks, DAPP reversal ordering, and deferred consistency trigger behavior.

## Next step

Obtain the independent review, record the owner's residual-risk decision, and complete backup/restore rehearsal plus staged rollout approval. Keep PR #5 Draft and do not merge or apply M3c to a persistent database before those gates.
