/* eslint-disable prettier/prettier */
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { TattooDetailDto } from './tattoo-detail.dto';

export enum PrestationType {
  TATTOO = 'TATTOO',
  PIERCING = 'PIERCING',
  RETOUCHE = 'RETOUCHE',
  PROJET = 'PROJET',
}

export enum AppointmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  DECLINED = 'DECLINED',
  CANCELED = 'CANCELED',
}

export class UpdateAppointmentDto {
  @IsString()
  @IsNotEmpty()
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

  // @IsString()
  // @IsNotEmpty()
  // clientFirstname: string;

  // @IsString()
  // @IsNotEmpty()
  // clientLastname: string;

  // @IsEmail()
  // @IsOptional()
  // clientEmail: string;

  // @IsString()
  // @IsOptional()
  // clientPhone: string;

  @IsString()
  @IsOptional()
  tatoueurId: string;

  // @IsString()
  // @IsOptional()
  // status: AppointmentStatus;

  @ValidateNested()
  @Type(() => TattooDetailDto) // C'EST CA QUI MANQUE
  @IsOptional()
  tattooDetail?: TattooDetailDto;
}
