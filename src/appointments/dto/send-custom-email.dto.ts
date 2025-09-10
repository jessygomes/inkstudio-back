import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class SendCustomEmailDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'Le sujet doit contenir au moins 3 caractères' })
  @MaxLength(200, { message: 'Le sujet ne peut pas dépasser 200 caractères' })
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Le message doit contenir au moins 10 caractères' })
  @MaxLength(2000, {
    message: 'Le message ne peut pas dépasser 2000 caractères',
  })
  message: string;
}
