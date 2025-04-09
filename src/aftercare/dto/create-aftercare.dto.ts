/* eslint-disable prettier/prettier */
import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class CreateAftercareDto {
  @IsString()
  clientId: string;

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
