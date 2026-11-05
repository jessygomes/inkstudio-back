import { IsString, MaxLength } from 'class-validator';

export class RemoveSalonPhotoDto {
  @IsString()
  @MaxLength(2048)
  url!: string;
}
