import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class GetUsersDto {
  @IsOptional() @IsString() query?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() style?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt() @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt() @Min(1) @Max(50)
  limit: number = 12;
}
