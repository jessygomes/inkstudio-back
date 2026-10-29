import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class EmailRequestDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
}
export class EmailTokenDto extends EmailRequestDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token: string;
}
export class ResetPasswordDto extends EmailTokenDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
