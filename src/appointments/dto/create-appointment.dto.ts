import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { PiercingZone } from '@prisma/client';

export enum PrestationType {
  TATTOO = 'TATTOO',
  PIERCING = 'PIERCING',
  RETOUCHE = 'RETOUCHE',
  PROJET = 'PROJET',
}

export class CreateAppointmentDto {  
  @IsOptional()
  @IsString()
  userId?: string; // Permet de créer un RDV pour un client spécifique (admin ou tatoueur)

  @IsOptional()
  @IsString()
  title?: string;

  @IsEnum(PrestationType)
  @IsNotEmpty()
  prestation: PrestationType;

  @IsString()
  @IsNotEmpty()
  start: string;

  @IsString()
  @IsNotEmpty()
  end: string;

  @IsString()
  @IsNotEmpty()
  clientFirstname: string;

  @IsString()
  @IsNotEmpty()
  clientLastname: string;

  @IsEmail()
  @IsNotEmpty()
  clientEmail: string;

  @IsOptional()
  @IsString()
  clientPhone?: string;

  @IsOptional()
  @IsString()
  clientBirthdate?: string;

  @IsString()
  @IsNotEmpty()
  tatoueurId: string;

  @IsBoolean()
  @IsOptional()
  isPayed?: boolean = false;

  @IsOptional()
  @IsBoolean()
  visio?: boolean = false; // coche la case ou non

  @IsString()
  @IsOptional()
  visioRoom?: string;

  // Infos projet (facultatif)
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() colorStyle?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() sketch?: string;
  @IsOptional() estimatedPrice?: number;
  @IsOptional() price?: number;

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