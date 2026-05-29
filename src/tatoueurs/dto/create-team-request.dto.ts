import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTeamRequestDto {
  @IsString()
  @IsNotEmpty()
  tatoueurUserId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
