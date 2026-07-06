import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class CreateFlashDto {
  @IsString()
  title: string;

  @IsUrl()
  imageUrl: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @Type(() => Number)
  @IsNumber()
  @Min(15)
  appointmentDurationMinutes: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  dimension?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsString()
  tatoueurId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  style?: string[];
}
