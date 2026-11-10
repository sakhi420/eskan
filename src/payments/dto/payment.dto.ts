import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../generated/prisma/enums';
import { MoneyDto } from '../../common/money/money.dto';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

export class PaymentDto {
  @IsUUID()
  residentId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsEnum(PaymentMethod)
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