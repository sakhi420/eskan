import { PaymentMethod } from '../../generated/prisma/enums';

/**
 * D-16 manual payment methods accepted from clients. `DEPOSIT_APPLICATION` is an
 * internal, non-cash settlement method created only by the deposit-application
 * flow — it must never be selectable through a normal payment/expense request.
 */
export const MANUAL_PAYMENT_METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.MOBILE_MONEY,
  PaymentMethod.OTHER,
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
