import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AppleLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16384)
  identityToken: string;

  // Raw nonce sent by the client when it requested the Apple authorization.
  @IsOptional()
  @IsString()
  @MaxLength(256)
  nonce?: string;

  // Apple only returns the name on the very first authorization, outside the signed token.
  // It is cosmetic (never used for authorization) and only applied when creating an account.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}
