/* eslint-disable prettier/prettier */
import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CreateTattooDetailDto {
  @IsString()
  clientId: string;

  @IsString()
  type: string;

  @IsString()
  zone: string;

  @IsString()
  size: string;

  @IsString()
  colorStyle: string;

  @IsOptional()
  @IsString()
  reference: string;

  @IsOptional()
  @IsString()
  sketch: string;

  @IsOptional()
  @IsNumber()
  estimatedPrice: number;
}
