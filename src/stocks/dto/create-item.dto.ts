import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateStockDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  unit: string;

  @IsOptional()
  @IsNumber()
  minQuantity: number;
}
