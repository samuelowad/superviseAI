import { IsIn, IsOptional, IsUUID } from 'class-validator';

import { CoachingMode, LearnerProfile } from '../entities/coaching-session.entity';

export class StartCoachingDto {
  @IsOptional()
  @IsUUID()
  thesis_id?: string;

  @IsOptional()
  @IsIn(['mock_viva', 'argument_defender', 'socratic'])
  mode?: CoachingMode;

  @IsOptional()
  @IsIn(['standard', 'esl_support', 'anxious_speaker', 'advanced_researcher'])
  learner_profile?: LearnerProfile;
}
