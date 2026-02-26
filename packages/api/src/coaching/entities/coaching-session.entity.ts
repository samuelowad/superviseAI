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

@Entity('coaching_sessions')
export class CoachingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'thesis_id', type: 'uuid' })
  thesisId!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  transcript!: TranscriptMessage[];

  @Column({ name: 'readiness_score', type: 'int', nullable: true })
  readinessScore!: number | null;

  @Column({ name: 'weak_topics', type: 'jsonb', default: () => "'[]'" })
  weakTopics!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
