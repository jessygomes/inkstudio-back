/* eslint-disable prettier/prettier */
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
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
  @IsNotEmpty()
  title: string;

  @IsEnum(PrestationType)
  prestation: PrestationType;

  @IsDateString()
  start: string;

  @IsDateString()
  end: string;

  @IsString()
  @IsNotEmpty()
  clientName: string;

  @IsEmail()
  clientEmail: string;

  @IsString()
  @IsNotEmpty()
  tatoueurId: string;
}
