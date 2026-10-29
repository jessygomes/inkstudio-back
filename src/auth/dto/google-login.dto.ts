import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16384)
  idToken: string;
}
