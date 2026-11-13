import { IsOptional, IsUUID } from 'class-validator';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

export class BedAssignmentDto {
  @IsUUID()
  bedId!: string;

  @IsUUID()
  residentId!: string;

  @IsUUID()
  contractId!: string;

  @IsDateOnly()
  startDate!: string;

  @IsOptional()
  @IsDateOnly()
  endDate?: string;
}
