import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

export class ResidencyPermissionsDto {
  @IsOptional() @IsBoolean() salonAllowsArtistCreate?: boolean;
  @IsOptional() @IsBoolean() salonAllowsArtistManage?: boolean;
  @IsOptional() @IsBoolean() salonAllowsPublicBooking?: boolean;
  @IsOptional() @IsBoolean() artistAllowsSalonView?: boolean;
  @IsOptional() @IsBoolean() artistAllowsSalonCreate?: boolean;
  @IsOptional() @IsBoolean() artistAllowsSalonManage?: boolean;
  @IsOptional() @IsBoolean() artistAllowsPublicBooking?: boolean;
}
export class ResidencyPresenceDto {
  @IsOptional() presence?: unknown;
}
export class CurrentSalonDto {
  @IsOptional() @IsString() residencyId?: string | null;
}
export class JoinSalonDto {
  @IsString() salonId: string;
  @IsOptional() @IsString() message?: string;
}
export class RespondResidencyDto {
  @IsIn(['accept', 'refuse']) action: 'accept' | 'refuse';
}
