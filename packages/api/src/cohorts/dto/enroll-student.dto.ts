import { IsUUID } from 'class-validator';

export class EnrollStudentDto {
  @IsUUID()
  student_id!: string;
}
