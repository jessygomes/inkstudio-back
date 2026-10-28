import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class UpdateDrawingAssociationsDto {
  @IsOptional()
  @IsString()
  replaceSourceCardId?: string;

  @IsOptional()
  @IsString()
  replaceTattooCardId?: string;

  @IsOptional()
  @IsString()
  clientId?: string | null;

  @IsOptional()
  @IsString()
  clientUserId?: string | null;

  @IsOptional()
  @IsString()
  sourceAppointmentId?: string | null;

  @IsOptional()
  @IsString()
  tattooAppointmentId?: string | null;

  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}
