import { IsNumber, IsPositive, Min } from 'class-validator';

export class UpdateQuantityDto {
  @IsNumber()
  @IsPositive()
  @Min(0)
  quantity: number;
}
