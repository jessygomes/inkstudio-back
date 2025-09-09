import { IsOptional, IsString, IsNumber } from 'class-validator';

export class TattooDetailDto {
  @IsOptional()
  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  zone: string;

  @IsOptional()
  @IsString()
  size: string;

  @IsOptional()
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

  @IsOptional()
  @IsNumber()
  price: number;
}
