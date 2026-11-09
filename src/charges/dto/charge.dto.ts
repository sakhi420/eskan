import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ChargeType, EntrySide } from '../../generated/prisma/enums';
import { MoneyDto } from '../../common/money/money.dto';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

export class ChargeDto {
  @IsUUID()
  residentId!: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsEnum(ChargeType)
  type!: ChargeType;

  @IsOptional()
  @IsEnum(EntrySide)
  entrySide?: EntrySide;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsDateOnly()
  periodStart!: string;

  @IsDateOnly()
  periodEnd!: string;

  @IsDateOnly()
  dueDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}