import { IsEnum, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { MaintenanceStatus } from '../../generated/prisma/enums';

export class RoomDto {
  @IsString()
  @Length(1, 50)
  code!: string;

  @IsInt()
  floor!: number;

  @IsOptional()
  @IsEnum(MaintenanceStatus)
  maintenanceStatus?: MaintenanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
