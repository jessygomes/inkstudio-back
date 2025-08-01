/* eslint-disable prettier/prettier */
import {
  IsBoolean,
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
  @IsNotEmpty()
  userId: string;
  
  @IsString()
  title: string;

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

  @IsString()
  @IsOptional()
  clientPhone: string;

  @IsString()
  @IsNotEmpty()
  tatoueurId: string;

  @IsBoolean()
  @IsOptional()
  isPayed?: boolean = false;

  // Infos projet (facultatif)
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() colorStyle?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() sketch?: string;
  @IsOptional() estimatedPrice?: number;
  @IsOptional() price?: number;
}