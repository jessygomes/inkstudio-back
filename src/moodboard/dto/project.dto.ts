import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class PublishProjectDto {
  @IsIn(['PRIVATE', 'OPEN', 'MATCHED', 'CLOSED']) status: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsIn(['SMALL', 'MEDIUM', 'LARGE', '']) size?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  styles?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  hashtags?: string[];
  @IsOptional() @IsString() @MaxLength(120) bodyPlacement?: string;
  @IsOptional() @IsIn(['NONE', 'RADIUS', 'ANYWHERE', '']) mobility?: string;
  @ValidateIf((o) => o.mobility === 'RADIUS' || o.radiusKm != null)
  @IsInt()
  @Min(1)
  @Max(2000)
  radiusKm?: number;
}
export class ExploreProjectsDto {
  @IsOptional() @IsIn(['explore', 'proposals']) scope?: string;
  @IsOptional() @IsIn(['PENDING', 'ACCEPTED', 'REFUSED']) proposalStatus?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsIn(['SMALL', 'MEDIUM', 'LARGE']) size?: string;
  @IsOptional() @IsString() @MaxLength(60) style?: string;
  @IsOptional() @IsString() @MaxLength(60) hashtag?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
}
export class ProposeProjectDto {
  @IsString() @MinLength(1) @MaxLength(3000) message: string;
}
export class RespondProposalDto {
  @IsIn(['ACCEPTED', 'REFUSED']) status: string;
}
export class ReportProfessionalDto {
  @IsString() @MinLength(5) @MaxLength(3000) reason: string;
  @IsOptional() @IsString() proposalId?: string;
}
