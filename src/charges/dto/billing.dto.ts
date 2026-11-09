import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

export class BillingPreviewRequestDto {
  @IsDateOnly()
  periodStart!: string;

  @IsDateOnly()
  periodEnd!: string;

  @IsOptional()
  @IsUUID()
  residentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dueDayOfMonth?: number;
}

export class BillingPostRequestDto {
  @IsDateOnly()
  periodStart!: string;

  @IsDateOnly()
  periodEnd!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dueDayOfMonth?: number;
}