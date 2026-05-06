import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class AddMoodboardImageDto {
  @IsNotEmpty()
  @IsString()
  @IsUrl()
  url: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  position?: number;
}
