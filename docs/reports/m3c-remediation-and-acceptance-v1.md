# M3c Remediation & Acceptance Report

**Status:** CI VERIFIED — P1-7 HTTP ACCEPTANCE TESTS PASS; HUMAN REVIEW AND OWNER APPROVAL STILL REQUIRED  
**Base SHA:** `506947b2ac6f475f5c9418dfb640af5c9719bb10`  
**Verified head SHA:** `5ae15a26137ca3412c464a1926c3fac20843f4d8`  
**PR:** [#5 — M3c financial domain](https://github.com/sakhi420/eskan/pull/5) (Draft, not merged)  
**CI:** [Run #59 — success](https://github.com/sakhi420/eskan/actions/runs/43264884308) — 2026-11-12

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

All items below refer to the same verified PR head SHA `5ae15a26137ca3412c464a1926c3fac20843f4d8`, not an earlier branch revision.

| CI gate | Result |
|---|---:|
| Dependency install, Prisma Client generation, Build | PASS |
| ESLint, Prettier, OpenAPI validation, Prisma validation | PASS |
| Unit tests | 12 suites / 79 tests passed |
| E2E smoke tests | 4 suites / 29 tests passed |
| M-1, M-2, M-2 concurrency, M-2 Prisma parity | PASS |
| Idempotency-retention CHECK tests | PASS |
| M3a migration checks | 11/11 passed |
| M3b migration checks | 30/30 passed |
| M3c migration checks | 60/60 passed |
| PostgreSQL integration tests | 13 suites / 139 tests passed |

The new P1-7 HTTP suite passed in the same E2E run. It asserts the permission matrix over actual HTTP requests rather than relying only on service-level tests. The BOLA checks also read the other tenant's database rows after rejected mutation attempts to prove the rows remain unchanged.

## Migration and financial-integrity review

The two M3c migrations were applied in CI's ephemeral PostgreSQL environment. The M3c migration script passed both fresh replay and the separate pre-M3c baseline-upgrade rehearsal with representative M3b Payment/Charge/Allocation rows.

Additional database hardening included:
- Only internal `DEPOSIT_APPLICATION` payments may have a null receipt; normal payment methods require an official receipt.
- `PaymentRefund` and `LedgerReversal` are protected against UPDATE and DELETE.
- Expense financial identity is protected against rewriting; only reversal metadata/version/status may change through the reversal flow.
- Actor-user foreign keys for deposits and expenses use RESTRICT so posted actor attribution is not silently erased.
- M3c-owned tenant composite FKs are checked by name, not by a brittle global count.

No migration was applied to the developer's local database, Staging or Production. The CI run used disposable GitHub Actions PostgreSQL databases.

## Remaining review and release gates

- PR #5 remains **Draft** and unmerged.
- A separate human review of the financial migration and domain behavior is still recommended before merge; CI is not a substitute for design review.
- The earlier `npm install` reported 32 audit findings (4 low, 26 moderate, 2 high). They need dependency-impact triage; do not run `npm audit fix --force` blindly.
- Prepare and approve a backup/restore and staged rollout plan before applying migrations to any persistent environment.
- Sourcery's automated review is skipped because the PR exceeds its 20,000 changed-line limit. This is a tool limit, not a CI failure.

## Decision

**P1-7 is closed by current-head HTTP/Supertest evidence.** The full CI pipeline is green on the recorded SHA. Keep the PR Draft until the independent human review, dependency audit triage and migration rollout approval are complete.
