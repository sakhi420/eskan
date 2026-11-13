import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../generated/prisma/enums';
import { MANUAL_PAYMENT_METHODS } from '../../common/money/payment-method';
import { MoneyDto } from '../../common/money/money.dto';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

export class PaymentDto {
  @IsUUID()
  residentId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsIn(MANUAL_PAYMENT_METHODS)
  method!: PaymentMethod;

  @IsDateOnly()
  receivedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  payerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  payerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  payerRelation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  provisionalReceiptId?: string;
}

/** PaymentRefundRequest — actual cash return of an unallocated payment amount. */
export class PaymentRefundDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
