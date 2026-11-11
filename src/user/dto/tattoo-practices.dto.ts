import { TattooPractice } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TattooPracticesDto {
  @ApiPropertyOptional({ enum: TattooPractice, isArray: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray() @ArrayMaxSize(4) @ArrayUnique() @IsEnum(TattooPractice, { each: true })
  tattooPractices?: TattooPractice[];

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional() @IsString() @MaxLength(1000)
  tattooPracticeDetails?: string | null;
}
