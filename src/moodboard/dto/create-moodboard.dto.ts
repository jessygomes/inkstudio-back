import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMoodboardDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
