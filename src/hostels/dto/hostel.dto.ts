import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { MONEY_MAX } from '../../common/money/money.dto';

export class HostelDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MONEY_MAX)
  defaultRentAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  rentDueDayOfMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  absenceMinDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
