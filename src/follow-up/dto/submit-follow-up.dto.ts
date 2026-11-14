import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FOLLOW_UP_MAX_PHOTOS, HEALING_STATUSES, type HealingStatus } from '../healing';

export class SubmitFollowUpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  /** Satisfaction (1 à 5). */
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  /** État de la cicatrisation (facultatif pour les liens envoyés avant son ajout). */
  @IsOptional()
  @IsIn(HEALING_STATUSES)
  healingStatus?: HealingStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  review?: string;

  /** Photos (1 à 3). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FOLLOW_UP_MAX_PHOTOS)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  photoUrls?: string[];

  /** Ancienne forme (une seule photo) : encore envoyée par la page de suivi du site Studio. */
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  photoUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPhotoPublic?: boolean;
}

export class ReplyFollowUpDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reply?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  response?: string;

  /** EMAIL (défaut) ou EMAIL_AND_INKERA (aussi dans la conversation Inkera du client, s'il en a une). */
  @IsOptional()
  @IsIn(['EMAIL', 'EMAIL_AND_INKERA'])
  channel?: 'EMAIL' | 'EMAIL_AND_INKERA';
}
