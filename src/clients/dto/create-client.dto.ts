/* eslint-disable prettier/prettier */
import { IsBoolean, IsDateString, IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateClientDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsDateString()
  birthDate: string;

  @IsOptional()
  @IsString()
  address: string;

  @IsString()
  userId: string; // ID du salon qui crée la fiche

  // Infos Tatouage
  @IsOptional() @IsString() description: string;
  @IsOptional() @IsString() zone: string;
  @IsOptional() @IsString() size: string;
  @IsOptional() @IsString() colorStyle: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() sketch?: string;
  @IsOptional() @IsNumber() estimatedPrice?: number;

    // Historique médical
    @IsOptional() @IsString() allergies?: string;
    @IsOptional() @IsString() healthIssues?: string;
    @IsOptional() @IsString() medications?: string;
    @IsOptional() @IsBoolean() pregnancy?: boolean;
    @IsOptional() @IsString() tattooHistory?: string;
}
