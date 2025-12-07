import { PartialType } from '@nestjs/mapped-types';
import { CreateSalonReviewDto } from './create-salon-review.dto';

export class UpdateSalonReviewDto extends PartialType(CreateSalonReviewDto) {}
