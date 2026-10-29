import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class RegisterUploadedFileDto {
  @IsIn(['pro', 'public'])
  application: 'pro' | 'public';

  @IsString()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  ownerUserId: string;

  @IsString()
  @MaxLength(512)
  @Matches(/^[a-zA-Z0-9_.-]+$/)
  key: string;

  @IsInt()
  timestamp: number;
}

export class AuthorizeFileDeletionDto {
  @IsIn(['pro', 'public'])
  application: 'pro' | 'public';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  @Matches(/^[a-zA-Z0-9_.-]+$/, { each: true })
  fileKeys: string[];

  // Only administrators may request deletion for a target account.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  ownerUserId?: string;
}

export class SignedUploadDto {
  @IsIn(['pro', 'public'])
  application: 'pro' | 'public';

  @IsString()
  @MaxLength(32768)
  payload: string;

  @IsInt()
  timestamp: number;
}
