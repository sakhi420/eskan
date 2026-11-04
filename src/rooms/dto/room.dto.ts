import { IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class RoomDto {
  @IsString()
  @Length(1, 50)
  code!: string;

  @IsInt()
  floor!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}