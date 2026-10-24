import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';

export class AppointmentPhotoDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

export class AddAppointmentPhotosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AppointmentPhotoDto)
  photos: AppointmentPhotoDto[];
}
