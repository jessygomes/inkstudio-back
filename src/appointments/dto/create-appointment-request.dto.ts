import { PrestationType } from "@prisma/client";
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateAppointmentRequestDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEnum(PrestationType)
  @IsNotEmpty()
  prestation: PrestationType;

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
  clientPhone: string;

  @IsString()
  @IsNotEmpty()
  availability: string;

  @IsString()
  details?: string;

  @IsString()
  @IsOptional()
  message: string;
}