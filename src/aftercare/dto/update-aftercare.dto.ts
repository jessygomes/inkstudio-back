/* eslint-disable prettier/prettier */
import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class UpdateAftercareDto {
  @IsOptional()
  @IsString()
  photoUrl: string;

  @IsOptional()
  @IsString()
  comment: string;

  @IsOptional()
  @IsBoolean()
  approved: boolean;

  @IsOptional()
  @IsBoolean()
  visibleInPortfolio: boolean;
}
