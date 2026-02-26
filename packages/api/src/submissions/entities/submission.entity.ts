import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SubmissionStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

@Entity('submissions')
export class Submission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'thesis_id', type: 'uuid' })
  thesisId!: string;

  @Column({ name: 'version_number', type: 'int' })
  versionNumber!: number;

  @Column({ name: 'file_key' })
  fileKey!: string;

  @Column({ name: 'file_name' })
  fileName!: string;

  @Column({ type: 'text', nullable: true })
  extractedText!: string | null;

  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    default: SubmissionStatus.PROCESSING,
  })
  status!: SubmissionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
