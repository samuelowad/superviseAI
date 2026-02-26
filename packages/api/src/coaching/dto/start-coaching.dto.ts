import { IsOptional, IsUUID } from 'class-validator';

export class StartCoachingDto {
  @IsOptional()
  @IsUUID()
  thesis_id?: string;
}
