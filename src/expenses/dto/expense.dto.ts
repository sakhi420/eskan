import { IsDefined, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../generated/prisma/enums';
import { MoneyDto } from '../../common/money/money.dto';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

/** ExpenseRequest — a paid expense only (D-14); no accounts payable. */
export class ExpenseCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsDateOnly()
  spentAt!: string;

  @IsOptional()
  @IsUUID()
  hostelId?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}