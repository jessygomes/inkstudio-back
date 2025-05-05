/* eslint-disable prettier/prettier */
import { IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  salonName: string;

  @IsString()
  @IsOptional()
  image: string;

  @IsString()
  phone: string;

  @IsString()
  address: string;

  @IsString()
  city: string;

  @IsString()
  postalCode: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsString()
  @IsOptional()
  salonHours: string;

  @IsOptional()
  @IsString()
  website: string;

  @IsOptional()
  @IsString()
  instagram: string;

  @IsOptional()
  @IsString()
  facebook: string;

  @IsOptional()
  @IsString()
  tiktok: string;
}
