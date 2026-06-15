import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendClientEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;
}
