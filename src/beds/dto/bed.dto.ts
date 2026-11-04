import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class BedDto {
  @IsString()
  @Length(1, 50)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}