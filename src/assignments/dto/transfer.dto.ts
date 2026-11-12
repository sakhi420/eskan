import { IsOptional, IsUUID } from 'class-validator';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

export class TransferDto {
  @IsUUID()
  bedId!: string;

  @IsDateOnly()
  startDate!: string;

  @IsOptional()
  @IsDateOnly()
  endDate?: string;
}
