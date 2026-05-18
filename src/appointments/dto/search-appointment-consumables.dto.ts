import { IsDateString, IsOptional, IsString } from 'class-validator';

export class SearchAppointmentConsumablesDto {
  @IsOptional()
  @IsString()
  lotNumber?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsDateString()
  expirationDateFrom?: string;

  @IsOptional()
  @IsDateString()
  expirationDateTo?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
