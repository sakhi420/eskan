import { IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class BedAssignmentDto {
  @IsUUID()
  bedId!: string;

  @IsUUID()
  residentId!: string;

  @IsUUID()
  contractId!: string;

  @Matches(DATE_RE)
  startDate!: string;

  @IsOptional()
  @Matches(DATE_RE)
  endDate?: string;
}