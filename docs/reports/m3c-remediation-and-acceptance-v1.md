# M3c Remediation & Acceptance Report

**Status:** REMEDIATION PATCH PUSHED — LOCAL VALIDATION AND INDEPENDENT REVIEW REQUIRED (CI not verified)
**Base SHA:** `506947b2ac6f475f5c9418dfb640af5c9719bb10`
**Head at start of remediation:** `62c5b391201849e5292a39152e960e48ceff4647`
**Target branch:** `feat/m3c-deposit-expense-refund-reversal`

## Remediation table

| ID | Item | Severity | Change | Evidence | Result |
|---|---|---|---|---|---|
| P0-1 | Payment refund not deducted from allocatable balance | P0 | canonical `unappliedBalance()` = amount − allocations + releases − refunds; `refundPayment` uses it directly (no double-subtract) | `m3c-remediation` "P0-1" | PASS |
| P0-2 | DAPP forgeable via normal payment path | P0 | `MANUAL_PAYMENT_METHODS` DTO restriction + service rejection + `payments_dapp_has_no_receipt` CHECK | `m3c-remediation` "P0-2" + migration check | PASS |
| P0-3 | DAPP reversal must restore Held + reopen charge once | P0 | dedicated `reverseApplication()`; generic allocation/create/release/refund/reverse reject DAPP; sole Allocation is checked | remediation integration + DB constraints (run locally) | IMPLEMENTED; execution not verified here |
| P1-1 | Deposits balanced per source, not per resident | P1 | `source_deposit_transaction_id` self-FK + `sourceHeld()`; refund/forfeit/apply source-scoped | `m3c-remediation` "P1-1" | PASS |
| P1-2 | SyncChange for every changed entity | P1 | allocation/release/charge sync emitted in `apply`, `reversePayment`, `reverseApplication` | code + reconciliation oracle | PASS |
| P1-3 | LedgerReversal side = opposite of original posting | P1 | documented mapping; payment→DEBIT, RECEIVED→DEBIT, REFUNDED/FORFEITED→CREDIT, expense→CREDIT | `m3c-remediation` "P1-3" | PASS |
| P1-4 | Structural DAPP↔Payment↔Allocation linkage | P1 | FK columns + composite tenant FKs + UNIQUE 1:1 | migration check (33 composite FKs) | PASS |
| P1-5 | Idempotent replay returns committed snapshot | P1 | snapshot `toRecord`/`fromRecord` for apply + reversePayment | `m3c-remediation` "P1-5" | PASS |
| P1-6 | Final-checkout gate fails closed | P1 | require CLOSED/TERMINATED contract + no ACTIVE BedAssignment | `m3c-deposits-refund-reversal` checkout tests | PASS |
| P1-7 | HTTP role + tenant isolation | P1 | roles enforced via controller decorators (no new e2e written this pass) | `permissions-matrix.md` | PARTIAL (service-level; HTTP e2e not added) |
| P2 | Expense method required; amount>0 CHECK; append-only | P2 | expense `paymentMethod` required; DB CHECKs already present; DELETE triggers already present | migration check | PASS |

## Test evidence

- `npm run build` → exit 0
- `npx prisma validate` → exit 0
- `npx prisma generate` → exit 0
- `node scripts/test-m3c-migration.cjs` → **34/34 PASS** (parity empty; 33 composite tenant FKs)
- Integration source inventory after this patch: **33 test cases** (deposits-refund-reversal 20 · concurrency 4 · reconciliation 1 · remediation 8). This patch has not been executed in the current environment; run `npm run test:integration` locally and record actual PASS/FAIL/SKIP output.
- `npx @redocly/cli@1.25.15 lint contracts/openapi.yaml` → exit 0 (6 pre-existing warnings)

## Migration

- New additive migration: `20261112120000_m3c_dapp_reversal_and_deposit_source`
- Empty-DB fresh apply: covered by full migration replay.
- Baseline upgrade: the migration script now separately builds the pre-M3c schema,
  seeds representative M3b Payment/Charge/Allocation rows, applies only M3c migrations,
  checks row preservation, and compares Prisma parity. This rehearsal must be run locally.
  `eskan_dev`/Staging/Production **not migrated**.

## Remaining risks / open decisions

- P1-7 HTTP-layer e2e (roles + BOLA/tenant) remains open. Controller role decorators exist,
  but assertion-level Supertest tests for OWNER/ADMIN/OPERATOR/VIEWER and cross-tenant access
  are still required before financial release acceptance.
- DepositTransaction void now leaves the source row untouched and records LedgerReversal;
  effective status is projected from reversal events. The DB blocks source UPDATE/DELETE.
- OpenAPI now describes the DAPP reverse endpoint, manual-only input methods and the actual
  DepositApplication response fields. CI now includes lint and format checks; no CI run on
  the final SHA has been observed.
- "Final checkout" proof remains model-limited (no dedicated checkout-in-progress flag):
  implemented as CLOSED/TERMINATED contract + no ACTIVE BedAssignment (ADR-0011 §4).

## Next step

Owner review + PR creation against `main` (branch already pushed). Merge only with
independent owner decision.