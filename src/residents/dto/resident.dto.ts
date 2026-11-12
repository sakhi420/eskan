import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ResidentType } from '../../generated/prisma/enums';

export class ResidentDto {
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsEnum(ResidentType)
  type!: ResidentType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactRelation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
