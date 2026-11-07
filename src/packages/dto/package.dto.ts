import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PackageComponentKind } from '../../generated/prisma/enums';
import { MONEY_MAX } from '../../common/money/money.dto';

export class PackageComponentDto {
  @IsEnum(PackageComponentKind)
  kind!: PackageComponentKind;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(MONEY_MAX)
  amount!: number;

  @IsBoolean()
  deductibleOnAbsence!: boolean;
}

export class PackageDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PackageComponentDto)
  components!: PackageComponentDto[];
}