import { IsOptional, IsString } from 'class-validator';

export class UpdateUserClientDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  @IsOptional()
  image: string;

  @IsString()
  phone: string;

  @IsString()
  city: string;

  @IsString()
  postalCode: string;

  @IsString()
  birthDate: string;

  @IsString()
  pseudo: string;
}
