import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateTattooHistoryDto {
  @IsString()
  clientId: string;

  @IsOptional()
  @IsString()
  tatoueurId: string;

  @IsDateString()
  date: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  inkUsed?: string;

  @IsOptional()
  @IsString()
  healingTime?: string;

  @IsOptional()
  @IsString()
  careProducts?: string;
}
