import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsNotEmpty({ message: 'Le mot de passe actuel est requis' })
  @IsString({
    message: 'Le mot de passe actuel doit être une chaîne de caractères',
  })
  currentPassword: string;

  @IsNotEmpty({ message: 'Le nouveau mot de passe est requis' })
  @IsString({
    message: 'Le nouveau mot de passe doit être une chaîne de caractères',
  })
  @MinLength(8, {
    message: 'Le nouveau mot de passe doit contenir au moins 8 caractères',
  })
  // @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
  //   message:
  //     'Le nouveau mot de passe doit contenir au moins une minuscule, une majuscule, un chiffre et un caractère spécial',
  // })
  newPassword: string;

  @IsNotEmpty({ message: 'La confirmation du mot de passe est requise' })
  @IsString({ message: 'La confirmation doit être une chaîne de caractères' })
  confirmPassword: string;
}
