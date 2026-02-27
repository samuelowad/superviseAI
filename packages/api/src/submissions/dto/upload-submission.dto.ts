import { IsOptional, IsUUID } from 'class-validator';

export class UploadSubmissionDto {
  @IsOptional()
  @IsUUID()
  milestone_id?: string;
}
