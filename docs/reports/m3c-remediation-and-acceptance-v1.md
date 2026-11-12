# M3c Remediation & Acceptance Report

**Status:** CURRENT-HEAD CI VERIFIED — P1-7 HTTP ACCEPTANCE AND DAPP/CHARGE REVERSAL ORDERING PASS; HIGH/CRITICAL AUDIT GATE PASSES; HUMAN REVIEW AND OWNER APPROVAL STILL REQUIRED  
**Base SHA:** `506947b2ac6f475f5c9418dfb640af5c9719bb10`  
**Verified implementation head SHA:** `dfe84d32b10a92fd5df638bd24033fa0944d4a62`  
**PR:** [#5 — M3c financial domain](https://github.com/sakhi420/eskan/pull/5) (Draft, not merged)  
**CI:** [Run #92 — success](https://github.com/sakhi420/eskan/actions/runs/43275631701) — 2026-11-12

## Remediation table

| ID | Item | Severity | Implementation / verification | Result |
|---|---|---|---|---|
| P0-1 | Payment refund must reduce allocatable balance | P0 | Canonical `unappliedBalance()` is used by `refundPayment()`; current unit, E2E and integration gates passed | PASS |
| P0-2 | DAPP must not be forgeable through normal payment paths | P0 | DTO/service restrictions, DB receipt constraints, migration assertions; only internal DAPP may omit receipt | PASS |
| P0-3 | DAPP reversal restores Held and reopens the charge exactly once | P0 | Dedicated `reverseApplication()`, structural Payment/Allocation links and single-allocation guards; current E2E/integration and M3c DB tests passed | PASS |
| P1-1 | Deposit balance is calculated per source | P1 | Explicit `source_deposit_transaction_id` links and reversal-aware source balance projection; M3c migration and current integration gates passed | PASS |
| P1-2 | SyncChange for every changed entity | P1 | Posting/reversal paths emit transactional AuditEvent and SyncChange; current integration suite passed | PASS |
| P1-3 | LedgerReversal side is opposite to the original posting | P1 | Explicit side mapping for Charge, Payment, Deposit and Expense; current unit/integration gates passed | PASS |
| P1-4 | Structural DAPP ↔ Payment ↔ Allocation linkage | P1 | Composite tenant FKs, unique links and database trigger checking exact Payment/Allocation/Charge/amount identity; M3c DB checks passed | PASS |
| P1-5 | Idempotent replay returns the committed snapshot | P1 | `toRecord/fromRecord` paths for financial mutations; current unit/integration gates passed | PASS |
| P1-6 | Final-checkout gate fails closed | P1 | Requires CLOSED/TERMINATED contract and no ACTIVE bed assignment; current project test gates passed | PASS |
| P1-7 | HTTP role matrix and cross-tenant/BOLA isolation | P1 | New `test/m3c-authorization-tenant.e2e-spec.ts`: all four roles, financial routes, generic 404 for non-member selector, cross-tenant reads/mutations and post-attempt DB state checks | PASS |
| P2 | Expense method, positive amount, append-only and actor attribution | P2 | DB checks and update/delete guards; Expense reversal metadata remains mutable while financial identity is protected; M3c DB checks passed | PASS |

## Current-head verification evidence

All items below refer to the same verified implementation PR head SHA `10960c3856cc85a9482ee21c1369532a399341cb`, not an earlier branch revision.

| CI gate | Result |
|---|---:|
| `npm ci` from committed lockfile, Prisma Client generation, Build | PASS |
| ESLint, Prettier, OpenAPI validation, Prisma validation | PASS |
| Unit tests | 12 suites / 79 tests passed |
| E2E smoke tests | 4 suites / 29 tests passed |
| M-1, M-2, M-2 concurrency, M-2 Prisma parity | PASS |
| Idempotency-retention CHECK tests | PASS |
| M3a migration checks | 11/11 passed |
| M3b migration checks | 30/30 passed |
| M3c migration checks | 83/83 passed |
| PostgreSQL integration tests | 13 suites / 139 tests passed |

The new P1-7 HTTP suite passed in the same E2E run. It asserts the permission matrix over actual HTTP requests rather than relying only on service-level tests. The BOLA checks also read the other tenant's database rows after rejected mutation attempts to prove the rows remain unchanged.

## Migration and financial-integrity review

The two M3c migrations were applied in CI's ephemeral PostgreSQL environment. The committed dependency lockfile also upgrades NestJS packages to 12.5.0 and Multer to 2.5.0; the normal, non-regenerating `npm ci` workflow verified that exact lockfile. The M3c migration script passed fresh replay and the separate pre-M3c baseline-upgrade rehearsal with representative M3b Payment/Charge/Allocation rows. A second legacy-data rehearsal proved that a pre-existing REFUNDED/FORFEITED event without a structural source link stops the FIRST M3c migration before any DDL; the test also verified that no enum, table or actor column was left behind.

Additional database hardening included:
- Only internal `DEPOSIT_APPLICATION` payments may have a null receipt; normal payment methods require an official receipt.
- `PaymentRefund` and `LedgerReversal` are protected against UPDATE and DELETE.
- Expense financial identity is protected against rewriting; only reversal metadata/version/status may change through the reversal flow.
- Actor-user foreign keys for deposits and expenses use RESTRICT so posted actor attribution is not silently erased.
- M3c-owned tenant composite FKs are checked by name, not by a brittle global count.
- Database triggers require refunds/forfeitures to reference an unreversed POSTED RECEIVED deposit; DAPP must consume an unreversed POSTED RECEIVED deposit and a POSTED DEBIT charge.
- Refunds, forfeitures, and DAPP applications share one source-scoped balance cap. PostgreSQL locks the RECEIVED source row and rejects any new child event or application whose combined active amount would exceed the original received amount. The 83/83 M3c test run covered mixed 60 + 30 + 10 consumption and rejected further consumption.
- A DepositApplication can transition from POSTED to REVERSED only when its linked DAPP Payment is REVERSED, its complete AllocationRelease exists, exactly one matching DEBIT LedgerReversal exists, and its Charge is still POSTED. A deferred payment constraint prevents reversing the Payment alone; a trigger also rejects an Application-only status change.

No migration was applied to the developer's local database, Staging or Production. The CI run used disposable GitHub Actions PostgreSQL databases.

## Remaining review and release gates

- PR #5 remains **Draft** and unmerged.
- A separate second-person review of the financial migration and domain behavior is still required before merge; CI is not a substitute for design review.
- The committed lockfile removes the two High Multer-chain findings. The permanent `npm audit --audit-level=high` gate now passes on the exact current head. `npm audit` still reports 29 findings (4 low, 25 moderate, 0 high, 0 critical), mostly in development/test tooling; triage them separately and do not use `--force` blindly.
- The remaining findings are in the development/test dependency tree, not the production dependency set: `glob@13.0.7` is used by Jest reporters/config/runtime, while `glob@10.5.0` is nested below `test-exclude`; `minimatch@10.2.6` is used by ESLint/TypeScript-ESLint and the glob chain, and `minimatch@9.0.9` is nested below `test-exclude`; `deepmerge@4.3.1` is pulled by `jest-config`.
- Upstream advisories list `glob` as affected through 14.0.1 (fixed in 14.0.2) and `minimatch` as affected below 11.0.1. Current parents request incompatible major ranges (`glob@^13`, `glob@^10`, `minimatch@^10`, and `minimatch@^9`); a root override would force major-version mismatches rather than a safe patch update. The `deepmerge` advisory currently lists no patched release. These findings remain open and are not counted as fixed.
- Prepare and approve a backup/restore and staged rollout plan before applying migrations to any persistent environment.
- Sourcery's automated review is skipped because the PR exceeds its 20,000 changed-line limit. This is a tool limit, not a CI failure.

## Decision

**P1-7 is closed by current-head HTTP/Supertest evidence.** The full CI pipeline is green on the recorded SHA. Keep the PR Draft until the independent second-person migration review, remaining Low/Moderate dependency triage, and migration rollout/backup approval are complete.

## Follow-up review — DAPP / Charge reversal ordering (2026-11-12)

A focused service/database review found that the generic Charge reversal path released allocations and reversed the Charge without first checking whether a still-POSTED DepositApplication owned one of those allocations. That could leave the application POSTED (and its amount still deducted from Deposit Held) while the underlying Charge was REVERSED.

The feature branch now includes:
- A service guard in `ChargesService.reverseCharge()` that rejects the operation while a POSTED DepositApplication exists for the Charge; the caller must use the dedicated `reverseApplication()` path first.
- A PostgreSQL `BEFORE UPDATE OF status` trigger that rejects a Charge transition to REVERSED while a POSTED DepositApplication exists.
- Row locks in the deposit-source / DAPP link-validation triggers for source Deposit, Charge, and Allocation rows.
- A real-service Integration test that proves early Charge reversal is rejected without changing Charge/Application/release state, then reverses the DAPP and proves Charge reversal succeeds.
- A migration-level SQL test for the same database rule and its valid post-application-reversal transition.

**Verification status:** PASS on Run #92 (current implementation head SHA shown above). CI reports 83/83 M3c migration checks and 139/139 PostgreSQL integration tests. The added direct-SQL tests reject Application-only reversal, Payment-only reversal at commit, and incomplete reversal lacking either a full AllocationRelease or LedgerReversal; the complete compensating transaction passes.
