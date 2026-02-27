import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMilestoneDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  stage?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;
}
