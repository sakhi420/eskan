# M3c — Independent Review Handoff

**Prepared:** 2026-11-13  
**Repository:** `sakhi420/eskan`  
**Pull request:** [#5 — deposits, expenses, refunds, and reversals](https://github.com/sakhi420/eskan/pull/5)  
**Base SHA:** `506947b2ac6f475f5c9418dfb640af5c9719bb10`  
**Last PR head covered by full CI Run #102:** `787809e663d982cca58d1e61f95ac84a9a3a9999` (later commits update documentation only; implementation/test paths are unchanged).  
**Last code-bearing implementation SHA:** `3def75aab45c9080fccb889b2e8f96a4fc7418e7`  
**Latest exact-head CI:** [Run #102 — success](https://github.com/sakhi420/eskan/actions/runs/43278611645)  
**PR state:** Draft / open / not merged

## Purpose and limits

This document prepares an independent reviewer to examine the M3c financial domain and its two PostgreSQL migrations. It is a review handoff, **not** an independent approval or a merge authorization. The preparation review inspected the PR metadata, current diff inventory, the two migrations, key service flows, migration/integration test sources, the lockfile dependency tree, and the latest CI run. It does not replace a separate human review of the complete 169-file / 25,868-addition PR.

No M3c migration has been applied to `eskan_dev`, Staging, or Production. CI used disposable PostgreSQL databases. This preparation did not inspect or alter the developer's local working tree.

## Evidence already available

Run #102 completed successfully on exact PR head `787809e663d982cca58d1e61f95ac84a9a3a9999` at the time of that run. Its single `build-and-test` job completed all 27 substantive workflow steps successfully, including dependency installation/security gate, Prisma generation, build, ESLint, Prettier, OpenAPI and Prisma validation, unit tests, E2E smoke tests, migration checks, and PostgreSQL integration tests. Four documentation-only commits were added to this PR afterward; no runtime source, schema, migration, API contract, or test files changed in those commits. Run #102 is therefore evidence for the implementation and its then-current docs, not a claim that the newest documentation-only commit itself was re-run.

The detailed recorded test evidence on the code-bearing SHA `3def75a...` (Run #101), repeated by the full workflow on the current documentation-only follow-up head in Run #102, is:

| Gate | Recorded result |
|---|---:|
| Unit tests | 12 suites / 79 tests |
| E2E smoke tests | 4 suites / 29 tests |
| M3a migration checks | 11/11 |
| M3b migration checks | 30/30 |
| M3c migration checks | 99/99 |
| PostgreSQL integration | 13 suites / 139 tests |
| M-1 / M-2 / concurrency / parity / idempotency-retention checks | PASS |

A green CI result proves the recorded automated gates passed. It does not establish that the domain rules are complete, that a human has reviewed the SQL, or that a persistent database can be safely migrated.

## Required independent review

The reviewer should record **APPROVE**, **REQUEST CHANGES**, or **COMMENT** against the exact current head, and should not approve based only on this checklist.

### A. Migration safety and legacy-data preflight

- [ ] Read both migrations in full:
  - `20261112000000_m3c_deposit_refund_expense_reversal`
  - `20261112120000_m3c_dapp_reversal_and_deposit_source`
- [ ] Confirm the first migration's legacy REFUNDED/FORFEITED preflight executes before every M3c DDL statement and fails closed when a legacy event has no structural source link.
- [ ] Confirm the preflight failure rolls back without leaving enum types, tables, actor columns, or other partial M3c schema objects.
- [ ] Review upgrade behavior against a representative pre-M3c baseline and inspect whether all assumptions about the initially empty `deposit_applications` table are guaranteed by the migration sequence and deployment process.
- [ ] Inspect transactionality, PostgreSQL enum behavior, constraint creation order, rollback behavior, and Prisma schema parity.

### B. Deposit source accounting and concurrency

- [ ] Independently derive the source balance formula: original POSTED RECEIVED amount less unreversed REFUNDED/FORFEITED child events and POSTED DepositApplications.
- [ ] Confirm refund, forfeit, and application consume one shared source balance; none has an independent allowance.
- [ ] Confirm source-row locking serializes concurrent inserts and that no lock-order inversion is introduced across service operations.
- [ ] Confirm a RECEIVED event cannot be reversed while active children or applications remain.
- [ ] Confirm child reversal is allowed only while its parent RECEIVED event remains POSTED and unreversed.
- [ ] Confirm duplicate source/event reversals and creation of new children after source reversal are rejected.

### C. DepositApplication / internal Payment / Allocation integrity

- [ ] Verify a DAPP targets only a POSTED DEBIT Charge and an unreversed POSTED RECEIVED deposit.
- [ ] Verify the linked Payment has method `DEPOSIT_APPLICATION`, no receipt number, exact amount, and exactly one full Allocation to the same Charge.
- [ ] Verify generic Payment create/refund/reverse/allocation/release endpoints cannot mutate DAPP state.
- [ ] Verify DAPP reversal restores Deposit Held, fully releases the matching Allocation, records exactly one matching DEBIT LedgerReversal, and reopens the Charge only through the intended sequence.
- [ ] Verify Charge reversal is blocked while a DAPP remains POSTED.
- [ ] **Database reverse-link question:** the Application insert trigger validates that a DepositApplication references the exact Payment and Allocation, and the service creates all records in one transaction. Determine whether the database must also reject a directly inserted `DEPOSIT_APPLICATION` Payment that commits without a matching DepositApplication. If yes, request a deferred constraint trigger and a negative migration test. Treat this as a reviewer question to decide, not as a proven public-API exploit.

### D. Other financial invariants

- [ ] Confirm payment refunds reduce the canonical unapplied balance and cannot refund allocated funds.
- [ ] Confirm expense is paid-only and never accepts `DEPOSIT_APPLICATION` as a cash payment method.
- [ ] Confirm Charge, Payment, Deposit, Expense, refund and release events use positive integer AFN amounts and append-only / compensating-event semantics.
- [ ] Confirm the reversal side is opposite to the original posting and that duplicate reversals are rejected.
- [ ] Confirm every financial mutation commits its domain rows, idempotency record, AuditEvent, and SyncChange atomically.
- [ ] Confirm repeated idempotency requests return the committed resource snapshot and do not duplicate financial effects.

### E. Actor attribution and tenancy

- [ ] Verify all public mutation routes attach the authenticated actor to new financial events.
- [ ] **Legacy compatibility question:** `actor_user_id` is nullable on DepositTransaction/Expense to preserve historical rows. Determine whether a DB-level insert guard is required for new direct writes, or whether service-level enforcement is the accepted boundary.
- [ ] Verify actor references cannot be silently erased by deleting users where the schema uses RESTRICT.
- [ ] Re-check composite tenant/resident foreign keys, BOLA behavior, and OWNER / ADMIN / OPERATOR / VIEWER permissions against the locked Phase 9 decisions.

### F. Tests and failure paths

- [ ] Inspect whether tests assert the resulting database state, not only returned HTTP/service responses.
- [ ] Inspect concurrent refund/forfeit/application attempts, source reversal races, DAPP reversal races, and allocation release ordering.
- [ ] Confirm failure injection and transaction rollback leave no partial financial posting, AuditEvent, SyncChange, or idempotency state.
- [ ] Review whether tests cover the identified reverse-link and actor-attribution questions; add tests if either is promoted to a required invariant.

## Dependency audit disposition

The recorded audit lists **29 findings: 4 Low, 25 Moderate, 0 High, 0 Critical**. Exact lockfile inspection found the affected package instances in the development/test dependency graph (`dev: true`), not as direct production dependencies. These findings are triaged but **not fixed**:

| Locked package(s) | Advisory / patched version | Current constraint |
|---|---|---|
| `glob@13.0.7`, `glob@10.5.0` | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) / `14.0.2` | Parent dependencies require 13.x and 10.x. |
| `minimatch@10.2.6`, `minimatch@9.0.9` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) / `11.0.1` | Parent dependencies require 10.x and 9.x. |
| `deepmerge@4.3.1` | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) / no patched version listed | Pulled by `jest-config`. |

Do not use a blind `npm audit fix --force` or major-version root overrides to make the report appear green. The CI gate `npm audit --audit-level=high` passes; that does not remediate the 29 Low/Moderate findings. The project owner must accept this development-tooling risk explicitly or defer merge until compatible upstream versions are available. Review the advisories directly before sign-off.

## Backup, restore, and rollout gate

This has **not** been performed for M3c and must not be marked complete based on CI:

- [ ] Create a fresh, verified backup of the intended source database using the established operational procedure.
- [ ] Restore that backup into a separate isolated clone and verify database identity, schema, key row counts, and application connectivity.
- [ ] Run the M3c preflight and migration sequence only against the isolated clone; preserve logs and command outputs.
- [ ] Run migration status, Prisma parity, financial reconciliation, and relevant smoke tests on the clone.
- [ ] Record a rollback / restore decision and an ordered staged rollout plan.
- [ ] Obtain explicit owner approval before any M3c migration is applied to `eskan_dev`, Staging, or Production.

The current branch and CI have not changed any persistent environment.

## Approval record

| Gate | Current state | Evidence required to close |
|---|---|---|
| Automated CI | PASS | [Run #102](https://github.com/sakhi420/eskan/actions/runs/43278611645) |
| Independent second-person review | OPEN | Reviewer identity, exact-head review, and review result |
| Low/Moderate dependency risk | TRIAGED / OWNER ACCEPTANCE OPEN | Explicit owner risk decision or compatible package updates |
| Backup / restore rehearsal | OPEN | Clone source, backup/restore logs, reconciliation results |
| Staged rollout approval | OPEN | Written rollout/rollback plan and owner approval |
| Ready to merge | **NO** | All gates above closed; then owner authorizes un-Draft and merge |

**Current decision:** keep PR #5 Draft and unmerged. Do not deploy these migrations to a persistent database until the independent review and operational gates are closed.
