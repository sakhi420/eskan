# ADR-0011 — M3c: Deposit / Refund / Expense / Reversal

**Status:** Accepted (implementation + remediation)
**Date:** 2026-11-12 (amended for remediation 2026-11-12)
**Deciders:** delegated product decisions D-01..D-18 (authoritative: `ESKAN_PHASE9_EXECUTION_DIRECTIVE_v1_FA.md`)

## Context

M3c delivers the deposit ledger, deposit refund/forfeit/application, paid-expense
recording, and the strict separation of void/reversal, cash refund, and adjustment.
This ADR was amended to fix the P0 financial-integrity defects found in review.

## Decisions

1. **Deposit ledger is resident-scoped and strictly append-only, balanced per source.**
   `DepositTransaction` uses `DepositType { RECEIVED, REFUNDED, FORFEITED }`. A
   `REFUNDED`/`FORFEITED` event stores the source RECEIVED via the structural
   `source_deposit_transaction_id` self-FK (never inferred from Audit JSON). A void
   never updates the original row: it appends a `LedgerReversal` with the opposite side.

2. **Source-specific Deposit Held (D-08/D-09):**
   `Held(source) = RECEIVED(source) − active REFUNDED(source) − active FORFEITED(source) − POSTED APPLIED(source)`.
   A deposit event remains active unless a corresponding DEPOSIT LedgerReversal exists.
   Reversing a RECEIVED source requires all dependent refund/forfeit/application activity
   to have been reversed first. Resident-level `Deposit Held` is the sum over sources.

3. **D-10 deposit application is materially a non-cash settlement (P0-2/P0-3).**
   `apply()` creates, atomically: one internal `Payment`
   (`method = DEPOSIT_APPLICATION`, `receipt_number = NULL`), one `PaymentAllocation`,
   and one `DepositApplication` that structurally references BOTH (payment_id,
   allocation_id — 1:1 UNIQUE). No receipt counter, no cash receipt. `DEPOSIT_APPLICATION`
   is rejected by the normal payment DTO (`@IsIn` manual methods), the service
   (`createPayment`), the DB (`payments_dapp_has_no_receipt` CHECK), and the expense DTO.

4. **"Final checkout" gate (P1-6) fails closed:** application requires a finalized
   `CLOSED`/`TERMINATED` stay contract AND no `ACTIVE` bed assignment. The absence of an
   `ACTIVE` contract alone is NOT proof of checkout.

5. **Full void only (D-02), per-source.** The original posting row is never mutated;
   reversal records an append-only `LedgerReversal` with the **opposite** posting side.
   API status is an effective projection derived from the reversal record. No partial
   reversal. The reversal side mapping (original → reversal):

   | Source / event          | Original side | Reversal side |
   |-------------------------|---------------|---------------|
   | Charge (entrySide DEBIT) | DEBIT        | CREDIT        |
   | Charge (entrySide CREDIT)| CREDIT       | DEBIT         |
   | Payment (any method)     | CREDIT       | DEBIT         |
   | Deposit RECEIVED         | CREDIT       | DEBIT         |
   | Deposit REFUNDED         | DEBIT        | CREDIT        |
   | Deposit FORFEITED        | DEBIT        | CREDIT        |
   | Deposit application (DAPP)| DEBIT        | CREDIT        |
   | Expense                  | DEBIT        | CREDIT        |

6. **DAPP reversal (P0-3)** happens only through the dedicated endpoint
   `POST /deposit-applications/:id/reverse` (OWNER/ADMIN). In one transaction it releases
   the sole matching allocation, reverses the internal Payment, marks the DepositApplication
   REVERSED (restoring Held exactly once), and writes a PAYMENT LedgerReversal (DEBIT).
   Generic `refundPayment`/`reversePayment`/`createAllocation`/`releaseAllocation`
   endpoints reject DAPP. ReverseApplication also fails closed if an extra/mismatched
   Allocation exists for the internal payment.

7. **Expense is paid-only (D-14):** `paymentMethod` is required and restricted to
   `CASH|BANK_TRANSFER|MOBILE_MONEY|OTHER`; `DEPOSIT_APPLICATION` is rejected both in the
   DTO and via `expenses_payment_method_not_dapp` CHECK.

8. **Money is integer AFN (A-016)** everywhere; `amount > 0` CHECKs are present (already
   enforced for charges/payments/allocations/deposit_transactions/expenses and the new
   tables).

9. **Financial immutability (D-18)** extends to all financial documents via the shared
   `prevent_financial_document_delete` BEFORE DELETE trigger (append-only).

10. **Idempotent replay snapshots results (P1-5).** `apply` and `reversePayment` persist a
    non-sensitive snapshot (`applicationIds`, `totalApplied`, `remainingDepositBalance`;
    `paymentId`, `releaseIds`, `reversalId`) so replay returns the committed result, not a
    recomputation of a later state.

11. **Sync/Audit coverage (P1-2).** Every mutation emits `AuditEvent` + `SyncChange` for
    every changed entity (Payment, Allocation, AllocationRelease, Charge, DepositTransaction,
    DepositApplication, LedgerReversal, Expense) in the same transaction.

## Consequences

- `PaymentMethod` gains `DEPOSIT_APPLICATION`; `payments.receipt_number` is nullable.
- `DepositApplication` gained `payment_id`/`allocation_id`/`status`/`version`/`reversed_*`
  and `DepositTransaction` gained `source_deposit_transaction_id`.
- Database triggers protect immutable DepositTransaction rows, exact DAPP-to-Allocation
  linkage, and the one-full-allocation rule for DAPP.
- Reconciliation oracle: balances are asserted with independent raw SQL, not the service
  balance functions.