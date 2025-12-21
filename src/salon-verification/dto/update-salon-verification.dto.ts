import { PartialType } from '@nestjs/mapped-types';
import { CreateSalonVerificationDto } from './create-salon-verification.dto';

export class UpdateSalonVerificationDto extends PartialType(CreateSalonVerificationDto) {}
