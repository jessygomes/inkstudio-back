import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendPublicContactEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  @IsNotEmpty()
  @MaxLength(200)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bodyPart!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  projectDescription!: string;
}
