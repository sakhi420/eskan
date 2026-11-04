import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Role } from '../../generated/prisma/enums';

export class UpdateMemberDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}