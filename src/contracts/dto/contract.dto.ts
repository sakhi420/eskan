import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BillingCycle } from '../../generated/prisma/enums';
import { MoneyDto } from '../../common/money/money.dto';
import { PackageComponentDto } from '../../packages/dto/package.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ContractDto {
  @IsUUID()
  hostelId!: string;

  @IsUUID()
  residentId!: string;

  @Matches(DATE_RE)
  startDate!: string;

  @IsOptional()
  @Matches(DATE_RE)
  endDate?: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  rent!: MoneyDto;

  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyDto)
  deposit?: MoneyDto;

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