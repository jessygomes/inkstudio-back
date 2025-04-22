/* eslint-disable prettier/prettier */
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export enum PrestationType {
  TATTOO = 'TATTOO',
  PIERCING = 'PIERCING',
  RETOUCHE = 'RETOUCHE',
  PROJET = 'PROJET',
}

export class UpdateAppointmentDto {
  @IsString()
  userId: string;

  @IsString()
  @IsOptional()
  title: string;

  @IsEnum(PrestationType)
  @IsOptional()
  prestation: PrestationType;

  @IsDateString()
  @IsOptional()
  start: string;

  @IsDateString()
  @IsOptional()
  end: string;

  @IsString()
  @IsOptional()
  clientName: string;

  @IsEmail()
  @IsOptional()
  clientEmail: string;

  @IsEmail()
  @IsOptional()
  clientPhone: string;

  @IsString()
  @IsOptional()
  tatoueurId: string;
}
