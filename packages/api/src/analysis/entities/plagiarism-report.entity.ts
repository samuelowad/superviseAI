import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('plagiarism_reports')
export class PlagiarismReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'submission_id', type: 'uuid', unique: true })
  submissionId!: string;

  @Column({ name: 'similarity_percent', type: 'int' })
  similarityPercent!: number;

  @Column({ name: 'risk_level' })
  riskLevel!: 'green' | 'yellow' | 'red';

  @Column({ name: 'flagged_sections', type: 'jsonb', default: () => "'[]'" })
  flaggedSections!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
