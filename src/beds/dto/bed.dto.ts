import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { MaintenanceStatus } from '../../generated/prisma/enums';

export class BedDto {
  @IsString()
  @Length(1, 50)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsEnum(MaintenanceStatus)
  maintenanceStatus?: MaintenanceStatus;
}
