import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ProfessorReviewDto {
  @IsIn([
    'save_feedback',
    'return_to_student',
    'request_revisions',
    'approve_milestone',
    'mark_complete',
  ])
  action!:
    | 'save_feedback'
    | 'return_to_student'
    | 'request_revisions'
    | 'approve_milestone'
    | 'mark_complete';

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  feedback?: string;
}
