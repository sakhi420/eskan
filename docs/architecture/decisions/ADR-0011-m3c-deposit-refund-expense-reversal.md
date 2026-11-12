# ADR-0011 — M3c: Deposit / Refund / Expense / Reversal

**Status:** Accepted (implementation)
**Date:** 2026-11-12
**Deciders:** delegated product decisions D-01..D-18 (authoritative: `ESKAN_PHASE9_EXECUTION_DIRECTIVE_v1_FA.md`)

## Context

M3c delivers the deposit ledger, deposit refund/forfeit/application, paid-expense
recording, and the distinction between void/reversal, cash refund, and adjustment.

## Decisions

1. **Deposit ledger is resident-scoped and append-only.** `DepositTransaction` uses
   `DepositType { RECEIVED, REFUNDED, FORFEITED }`; application-to-charges is NOT a
   DepositType — it is the independent `DepositApplication` entity (contract v0.5.0 lock).

2. **Deposit Held is always derived, never stored:**
   `Held = Σ RECEIVED(POSTED) − Σ REFUNDED(POSTED) − Σ FORFEITED(POSTED) − Σ DepositApplication`
   computed per-resident after acquiring the org + resident locks.

3. **D-08/D-09 balance check is resident-level:** a refund/forfeit targets a specific
   RECEIVED deposit (path id) but may never drive the resident's held balance negative
   (`REFUND_EXCEEDS_DEPOSIT_BALANCE` / `DEPOSIT_BALANCE_INSUFFICIENT`).

4. **D-10 deposit application creates, atomically:** one internal `Payment`
   (`method = DEPOSIT_APPLICATION`, `receipt_number = NULL`), one `PaymentAllocation` to
   the explicitly selected DEBIT charge, and one `DepositApplication` reference — all in a
   single transaction. No ReceiptCounter increment, no cash receipt. Lock order is
   organization → resident → charge(s sorted) → dependent rows.

5. **"Final checkout" gate** (D-10): application is rejected with `CHECKOUT_REQUIRED`
   while the resident has an `ACTIVE` stay contract. (Assumption: a resident with no
   `ACTIVE` contract has completed checkout; the schema has no separate
   "checkout-in-progress" flag.)

6. **Full void only (D-02).** Reversal marks the source row `REVERSED` (with actor,
   reason, server time) and records an append-only `LedgerReversal` with the opposite
   side. No partial reversal. Charges/payments with valid allocations release them
   append-only first, so allocations are never orphaned.

7. **LedgerReversal side convention:** CHARGE → opposite of `entrySide`; PAYMENT → CREDIT;
   DEPOSIT → CREDIT; EXPENSE → DEBIT. `residentId` is nullable here because expenses are
   hostel-scoped (never exposed in a response for EXPENSE; only PaymentVoidResult exposes
   a LedgerReversal and always with a resident).

8. **Expense is paid-only (D-14).** `DEPOSIT_APPLICATION` is rejected as an expense
   payment method. Expenses reverse only via the full-void path with reason + actor.

9. **Money is integer AFN (A-016)** everywhere; new tables carry `amount > 0` CHECKs.

10. **Financial immutability (D-18)** extends to `deposit_transactions`, `expenses`,
    `ledger_reversals`, `payment_refunds`, and `deposit_applications` via the shared
    `prevent_financial_document_delete` BEFORE DELETE trigger.

## Consequences

- `PaymentMethod` gains `DEPOSIT_APPLICATION`; `payments.receipt_number` becomes nullable
  (internal settlement payments have no receipt).
- Reconciliation oracle: `Deposit Held` and the non-cash `DEPOSIT_APPLICATION` payments
  are asserted with independent raw SQL, not the service balance function.