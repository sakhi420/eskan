import { IsIn, IsInt, Max, Min } from 'class-validator';

/**
 * Upper bound for any money amount: a signed 32-bit integer (INT32_MAX), which
 * matches the Postgres `integer` type that Prisma `Int` maps to. Kept as a named
 * constant so DTO and database constraints stay visibly aligned with OpenAPI.
 */
export const MONEY_MAX = 2147483647;

/**
 * Positive money for financial documents (rent, charge, payment, expense,
 * deposit transaction, allocation, manual subscription payment). OpenAPI
 * `Money` requires `minimum: 1`; zero and negative amounts are rejected.
 */
export class MoneyDto {
  @IsInt()
  @Min(1)
  @Max(MONEY_MAX)
  amount!: number;

  @IsIn(['AFN'])
  currency!: string;
}

/**
 * Non-negative money for optional/settable amounts where zero is a legitimate
 * value (e.g. an optional contract deposit). OpenAPI `NonNegativeMoney` allows
 * `minimum: 0`; negative amounts are rejected.
 */
export class NonNegativeMoneyDto {
  @IsInt()
  @Min(0)
  @Max(MONEY_MAX)
  amount!: number;

  @IsIn(['AFN'])
  currency!: string;
}