import { IsOptional, IsString } from 'class-validator';

export class UpdateMoodboardDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
