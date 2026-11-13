# M3c — Independent Review Handoff

**Prepared:** 2026-11-13  
**Repository:** `sakhi420/eskan`  
**Pull request:** [#5 — deposits, expenses, refunds, and reversals](https://github.com/sakhi420/eskan/pull/5)  
**Base SHA:** `506947b2ac6f475f5c9418dfb640af5c9719bb10`  
**PR head covered by latest full CI Run #112:** `f554ebc62cff513c8f31e828ad68ffeb48bc52e3`  
**Last code-bearing implementation SHA:** `3def75aab45c9080fccb889b2e8f96a4fc7418e7`  
**Merge commit:** `4da7415f78278bb504d91c9ac0f1c3c91b6c1c35`  
**Latest full CI:** [Run #112 — success](https://github.com/sakhi420/eskan/actions/runs/43412431492), 31/31 workflow steps  
**PR state:** Merged on 2026-11-13 under explicit owner instruction

## Purpose and limits

This document prepares an independent reviewer to examine the M3c financial domain and its two PostgreSQL migrations after an owner-directed merge. It is a review handoff, **not** an independent approval or a migration/deployment authorization. The preparation review inspected the PR metadata, current diff inventory, the two migrations, key service flows, migration/integration test sources, the lockfile dependency tree, and recorded CI evidence. A separate human review is still outstanding.

No M3c migration has been applied to `eskan_dev`, Staging, or Production. CI used disposable PostgreSQL databases. This preparation did not inspect or alter the developer's local working tree.

## Evidence already available

Run #112 completed successfully on exact PR head `f554ebc62cff513c8f31e828ad68ffeb48bc52e3`. Its `build-and-test` job completed all 31 workflow steps successfully, including dependency installation/security gate, Prisma generation, build, ESLint, Prettier, OpenAPI and Prisma validation, unit tests, E2E smoke tests, migration checks, and PostgreSQL integration tests. This is the latest full PR CI evidence. The resulting code was merged with commit `4da7415f78278bb504d91c9ac0f1c3c91b6c1c35`.

The detailed test counts were established on code-bearing SHA `3def75a...` (Run #101) and re-run through the full workflow on PR head `f554ebc...` in Run #112:

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

Do not use a blind `npm audit fix --force` or major-version root overrides to make the report appear green. The CI gate `npm audit --audit-level=high` passes; that does not remediate the 29 Low/Moderate findings. The owner directed the merge while these findings remained open; this is not remediation and does not mean the findings are harmless. Keep them in the risk register and revisit when compatible upstream versions are available, before any Staging/Production rollout.

## Backup, restore, and rollout gate

This has **not** been performed for M3c and must not be marked complete based on CI:

- [ ] Create a fresh, verified backup of the intended source database using the established operational procedure.
- [ ] Restore that backup into a separate isolated clone and verify database identity, schema, key row counts, and application connectivity.
- [ ] Run the M3c preflight and migration sequence only against the isolated clone; preserve logs and command outputs.
- [ ] Run migration status, Prisma parity, financial reconciliation, and relevant smoke tests on the clone.
- [ ] Record a rollback / restore decision and an ordered staged rollout plan.
- [ ] For the authorized local development migration only, complete the backup and isolated restore rehearsal described in `docs/operations/ESKAN_M3C_MIGRATION_EXECUTION_PROMPT_FA.md` before applying M3c to `eskan_dev`.
- [ ] Do not apply M3c to Staging or Production under this instruction. Those environments require a separate approval and the independent review.

The merge and CI have not changed any persistent database. The M3c migrations have not yet been applied to `eskan_dev`, Staging, or Production.

## Approval record

| Gate | Current state | Evidence required to close |
|---|---|---|
| Automated CI | PASS | [Run #112](https://github.com/sakhi420/eskan/actions/runs/43412431492) — 31/31 steps |
| Owner-directed merge | DONE | PR #5 merged as `4da7415f78278bb504d91c9ac0f1c3c91b6c1c35` |
| Independent second-person review | OPEN | Reviewer identity, exact-merge-head review, and review result |
| Low/Moderate dependency findings | TRIAGED / UNPATCHED | 4 Low / 25 Moderate; no claim of remediation |
| Local `eskan_dev` backup/restore rehearsal | OPEN | Backup hash, Clone restore and reconciliation logs |
| Staging / Production rollout | NOT AUTHORIZED | Independent review and separate owner authorization required |
| M3c migration on `eskan_dev` | PENDING | Follow the controlled execution prompt; do not skip any Gate |

**Current decision:** PR #5 is merged by explicit owner instruction, not by independent approval. Execute the M3c migration instruction only on local `eskan_dev` after Backup/Restore rehearsal and all clone tests pass. Do not migrate Staging or Production.
