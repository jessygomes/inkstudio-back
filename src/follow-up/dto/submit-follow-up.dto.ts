import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SubmitFollowUpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  review?: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  photoUrl: string;

  @IsOptional()
  @IsBoolean()
  isPhotoPublic?: boolean;
}
