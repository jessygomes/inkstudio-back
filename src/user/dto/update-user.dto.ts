import { Transform } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nickname?: string;

  @IsString()
  salonName: string;

  @IsString()
  @IsOptional()
  image: string;

  @IsString()
  @IsOptional()
  profileImage: string;

  @IsString()
  phone: string;

  @IsString()
  address: string;

  @IsString()
  city: string;

  @IsString()
  postalCode: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsString()
  @IsOptional()
  salonHours: string;

  @IsOptional()
  @IsString()
  website: string;

  @IsOptional()
  @IsString()
  instagram: string;

  @IsOptional()
  @IsString()
  facebook: string;

  @IsOptional()
  @IsString()
  tiktok: string;

  @IsArray()
  prestations: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  style?: string[];
}
