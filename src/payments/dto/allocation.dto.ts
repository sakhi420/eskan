import { IsDefined, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MoneyDto } from '../../common/money/money.dto';

export class PaymentAllocationDto {
  @IsUUID()
  chargeId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;
}

export class AllocationReleaseDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}