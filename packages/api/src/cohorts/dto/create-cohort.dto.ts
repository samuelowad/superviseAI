import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCohortDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  citation_style?: string;
}
