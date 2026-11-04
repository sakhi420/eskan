import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 72)
  password!: string;

  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsString()
  @Length(1, 200)
  organizationName!: string;
}