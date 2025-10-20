import { IsString, IsOptional } from 'class-validator';

export class UpdateColorProfileDto {
  @IsOptional()
  @IsString()
  colorProfile?: string;

  @IsOptional()
  @IsString()
  colorProfileBis?: string;
}