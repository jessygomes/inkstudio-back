import { IsString, MinLength } from 'class-validator';

export class StyleNameDto {
  @IsString()
  @MinLength(1)
  name: string;
}
