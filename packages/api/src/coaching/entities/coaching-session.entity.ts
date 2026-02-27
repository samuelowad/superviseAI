import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface TranscriptMessage {
  role: 'system' | 'assistant' | 'student';
  content: string;
}

export type CoachingMode = 'mock_viva' | 'argument_defender' | 'socratic';

@Entity('coaching_sessions')
export class CoachingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'thesis_id', type: 'uuid' })
  thesisId!: string;

  @Column({ type: 'text', default: 'mock_viva' })
  mode!: CoachingMode;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  transcript!: TranscriptMessage[];

  @Column({ name: 'generated_questions', type: 'jsonb', default: () => "'[]'" })
  generatedQuestions!: string[];

  @Column({ name: 'readiness_score', type: 'int', nullable: true })
  readinessScore!: number | null;

  @Column({ name: 'weak_topics', type: 'jsonb', default: () => "'[]'" })
  weakTopics!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
