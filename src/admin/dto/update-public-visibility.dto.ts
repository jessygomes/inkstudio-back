import { PublicVisibility } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdatePublicVisibilityDto {
  @IsEnum(PublicVisibility)
  publicVisibility: PublicVisibility;
}
