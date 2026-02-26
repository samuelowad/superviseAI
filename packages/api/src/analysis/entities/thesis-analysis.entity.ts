import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('thesis_analysis')
export class ThesisAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'submission_id', type: 'uuid', unique: true })
  submissionId!: string;

  @Column({ name: 'progress_score', type: 'int' })
  progressScore!: number;

  @Column({ name: 'trend_delta', type: 'int', default: 0 })
  trendDelta!: number;

  @Column({ name: 'is_first_submission', default: true })
  isFirstSubmission!: boolean;

  @Column({ name: 'abstract_alignment_verdict', default: 'insufficient_data' })
  abstractAlignmentVerdict!: string;

  @Column({ name: 'key_topic_coverage', type: 'jsonb', default: () => "'[]'" })
  keyTopicCoverage!: string[];

  @Column({ name: 'missing_core_sections', type: 'jsonb', default: () => "'[]'" })
  missingCoreSections!: string[];

  @Column({ name: 'structural_readiness', default: 'developing' })
  structuralReadiness!: string;

  @Column({ name: 'additions_count', type: 'int', default: 0 })
  additionsCount!: number;

  @Column({ name: 'deletions_count', type: 'int', default: 0 })
  deletionsCount!: number;

  @Column({ name: 'major_edits_count', type: 'int', default: 0 })
  majorEditsCount!: number;

  @Column({ name: 'gaps_resolved', type: 'int', default: 0 })
  gapsResolved!: number;

  @Column({ name: 'gaps_open', type: 'int', default: 0 })
  gapsOpen!: number;

  @Column({ name: 'previous_excerpt', type: 'text', nullable: true })
  previousExcerpt!: string | null;

  @Column({ name: 'current_excerpt', type: 'text', nullable: true })
  currentExcerpt!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
