import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ThesisStatus {
  DRAFT = 'draft',
  SUPERVISED = 'supervised',
  SUBMITTED_TO_PROF = 'submitted_to_prof',
  RETURNED_TO_STUDENT = 'returned_to_student',
  COMPLETED = 'completed',
}

@Entity('theses')
export class Thesis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'student_id', type: 'uuid', unique: true })
  studentId!: string;

  @Column({ name: 'supervisor_id', type: 'uuid', nullable: true })
  supervisorId!: string | null;

  @Column({ name: 'supervisor_name', type: 'text', nullable: true })
  supervisorName!: string | null;

  @Column()
  title!: string;

  @Column({ type: 'text', nullable: true })
  abstract!: string | null;

  @Column({
    type: 'enum',
    enum: ThesisStatus,
    default: ThesisStatus.DRAFT,
  })
  status!: ThesisStatus;

  @Column({ name: 'latest_professor_feedback', type: 'text', nullable: true })
  latestProfessorFeedback!: string | null;

  @Column({ name: 'latest_feedback_at', type: 'timestamptz', nullable: true })
  latestFeedbackAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
