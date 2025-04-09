/* eslint-disable prettier/prettier */
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateTattooHistoryDto {
  @IsString()
  clientId: string;

  @IsDateString()
  date: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  beforeImage: string;

  @IsOptional()
  @IsString()
  afterImage?: string;

  @IsOptional()
  @IsString()
  inkUsed: string;

  @IsOptional()
  @IsString()
  healingTime: string;

  @IsOptional()
  @IsString()
  careProducts: string;
}
