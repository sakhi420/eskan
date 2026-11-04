import { IsIn, IsInt, Min } from 'class-validator';

/**
 * Money is transported as an integer amount plus a currency code. Per decision
 * A-016 the MVP only supports AFN and amounts are always whole Afghani (no
 * FLOAT/DOUBLE is ever used for money).
 */
export class MoneyDto {
  @IsInt()
  @Min(0)
  amount!: number;

  @IsIn(['AFN'])
  currency!: string;
}