import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PieceSize } from '@prisma/client';

export class BatchPhotoItemDto {
  @IsString()
  imageUrl: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AddPhotosBatchDto {
  @IsEnum(PieceSize)
  pieceSize: PieceSize;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsArray()
  @IsString({ each: true })
  style: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];

  @IsOptional()
  @IsString()
  tatoueurId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BatchPhotoItemDto)
  photos: BatchPhotoItemDto[];
}
