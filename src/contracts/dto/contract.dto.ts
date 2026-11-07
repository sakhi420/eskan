import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BillingCycle } from '../../generated/prisma/enums';
import { MoneyDto, NonNegativeMoneyDto } from '../../common/money/money.dto';
import { PackageComponentDto } from '../../packages/dto/package.dto';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

export class ContractDto {
  @IsUUID()
  hostelId!: string;

  @IsUUID()
  residentId!: string;

  @IsDateOnly()
  startDate!: string;

  @IsOptional()
  @IsDateOnly()
  endDate?: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  rent!: MoneyDto;

  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @IsOptional()
  @ValidateNested()
  @Type(() => NonNegativeMoneyDto)
  deposit?: NonNegativeMoneyDto;

  @IsOptional()
  @IsUUID()
  packageId?: string;

  /**
   * Accepted for contract-compatibility only: the authoritative snapshot is
   * always derived server-side from the active accommodation package. Client
   * supplied components are ignored during create/update.
   */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PackageComponentDto)
  packageComponents?: PackageComponentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}