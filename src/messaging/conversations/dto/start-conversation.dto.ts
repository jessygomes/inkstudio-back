import { IsNotEmpty, IsString } from 'class-validator';

// Un client Inkera démarre un échange depuis un profil public professionnel.
// Aucun rendez-vous n'est nécessaire.
export class StartConversationDto {
  @IsString()
  @IsNotEmpty()
  professionalUserId: string;
}
