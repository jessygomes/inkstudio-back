import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTatoueurDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  img: string;

  @IsString()
  description: string;

  @IsString()
  @IsOptional()
  phone: string;

  @IsString()
  @IsOptional()
  hours: string;

  @IsString()
  @IsOptional()
  instagram: string;

  @IsArray()
  @IsOptional()
  style: string[];

  @IsArray()
  @IsOptional()
  skills: string[];
}
