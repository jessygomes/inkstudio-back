import { TattooPracticesDto } from '../../user/dto/tattoo-practices.dto';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTatoueurDto extends TattooPracticesDto {
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

  @IsBoolean()
  rdvBookingEnabled: boolean; // variable pour la prise de rendez-vous par tatoueur
}
