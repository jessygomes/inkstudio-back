/* eslint-disable prettier/prettier */
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export enum PrestationType {
  TATTOO = 'TATTOO',
  PIERCING = 'PIERCING',
  RETOUCHE = 'RETOUCHE',
  PROJET = 'PROJET',
}

export class CreateAppointmentDto {
  @IsString()
  title: string;

  @IsEnum(PrestationType)
  @IsNotEmpty()
  prestation: PrestationType;

  @IsDateString()
  @IsNotEmpty()
  start: string;

  @IsDateString()
  @IsNotEmpty()
  end: string;

  @IsString()
  @IsNotEmpty()
  clientName: string;

  @IsEmail()
  @IsNotEmpty()
  clientEmail: string;

  @IsString()
  @IsNotEmpty()
  tatoueurId: string;

  // Infos projet (facultatif)
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() colorStyle?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() sketch?: string;
  @IsOptional() estimatedPrice?: number;
}