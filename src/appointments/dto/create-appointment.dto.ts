import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PiercingZone } from '@prisma/client';
import { SkinTone } from '../constants/skin-tone.constants';

export enum PrestationType {
  TATTOO = 'TATTOO',
  PIERCING = 'PIERCING',
  RETOUCHE = 'RETOUCHE',
  PROJET = 'PROJET',
}

export class CreateAppointmentDto {  
  @ApiPropertyOptional({ description: 'ID du salon (admin/tatoueur)' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Titre du RDV (généré automatiquement si absent)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ enum: PrestationType, description: 'Type de prestation' })
  @IsEnum(PrestationType)
  @IsNotEmpty()
  prestation: PrestationType;

  @ApiProperty({ example: '2026-04-20T09:00:00.000Z', description: 'Début du RDV (ISO 8601)' })
  @IsString()
  @IsNotEmpty()
  start: string;

  @ApiProperty({ example: '2026-04-20T11:00:00.000Z', description: 'Fin du RDV (ISO 8601)' })
  @IsString()
  @IsNotEmpty()
  end: string;

  @ApiProperty({ example: 'Lea' })
  @IsString()
  @IsNotEmpty()
  clientFirstname: string;

  @ApiProperty({ example: 'Martin' })
  @IsString()
  @IsNotEmpty()
  clientLastname: string;

  @ApiProperty({ example: 'lea@example.com' })
  @IsEmail()
  @IsNotEmpty()
  clientEmail: string;

  @ApiPropertyOptional({ example: '0601020304' })
  @IsOptional()
  @IsString()
  clientPhone?: string;

  @ApiPropertyOptional({ example: '1996-08-12', description: 'Date de naissance (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  clientBirthdate?: string;

  @ApiPropertyOptional({ enum: SkinTone, description: 'Teinte de peau (requis pour TATTOO, RETOUCHE, PROJET)' })
  @IsOptional()
  @IsEnum(SkinTone)
  skin?: SkinTone;

  @ApiProperty({ description: 'ID du tatoueur (préfixe linked_ pour un user_tatoueur lié)' })
  @IsString()
  @IsNotEmpty()
  tatoueurId: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isPayed?: boolean = false;

  @ApiPropertyOptional({ default: false, description: 'Activer la visioconférence' })
  @IsOptional()
  @IsBoolean()
  visio?: boolean = false;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  visioRoom?: string;

  @ApiPropertyOptional({ description: 'ID du moodboard du client' })
  @IsOptional()
  @IsString()
  moodboardId?: string;

  // Infos projet (facultatif)
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: 'avant-bras' }) @IsOptional() @IsString() zone?: string;
  @ApiPropertyOptional({ example: 'medium' }) @IsOptional() @IsString() size?: string;
  @ApiPropertyOptional({ example: 'couleur' }) @IsOptional() @IsString() colorStyle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sketch?: string;
  @ApiPropertyOptional() @IsOptional() estimatedPrice?: number;
  @ApiPropertyOptional() @IsOptional() price?: number;

  // Champs spécifiques aux piercings
  @ValidateIf((object: CreateAppointmentDto) => object.prestation === PrestationType.PIERCING)
  @IsOptional()
  @IsEnum(PiercingZone)
  piercingZone?: PiercingZone;

  @IsOptional()
  @IsString()
  piercingServicePriceId?: string; // ID du service de piercing sélectionné

  // Champs de compatibilité avec l'ancien système
  @IsOptional()
  @IsString()
  piercingZoneOreille?: string;

  @IsOptional()
  @IsString()
  piercingZoneVisage?: string;

  @IsOptional()
  @IsString()
  piercingZoneBouche?: string;

  @IsOptional()
  @IsString()
  piercingZoneCorps?: string;

  @IsOptional()
  @IsString()
  piercingZoneMicrodermal?: string;
}