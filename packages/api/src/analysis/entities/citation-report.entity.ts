import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('citation_reports')
export class CitationReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'submission_id', type: 'uuid', unique: true })
  submissionId!: string;

  @Column({ name: 'citation_health_score', type: 'int' })
  citationHealthScore!: number;

  @Column({ name: 'issues_count', type: 'int' })
  issuesCount!: number;

  @Column({ name: 'missing_citations', type: 'jsonb', default: () => "'[]'" })
  missingCitations!: string[];

  @Column({ name: 'broken_references', type: 'jsonb', default: () => "'[]'" })
  brokenReferences!: string[];

  @Column({ name: 'formatting_errors', type: 'jsonb', default: () => "'[]'" })
  formattingErrors!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
