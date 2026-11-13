import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { IsTimeZone } from '../../common/validation/is-timezone.decorator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsIn(['AFN'])
  defaultCurrency?: string;
}
