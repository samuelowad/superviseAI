import { IsIn, IsOptional, IsUUID } from 'class-validator';

import { CoachingMode } from '../entities/coaching-session.entity';

export class StartCoachingDto {
  @IsOptional()
  @IsUUID()
  thesis_id?: string;

  @IsOptional()
  @IsIn(['mock_viva', 'argument_defender', 'socratic'])
  mode?: CoachingMode;
}
