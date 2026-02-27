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
export type LearnerProfile = 'standard' | 'esl_support' | 'anxious_speaker' | 'advanced_researcher';
export type DifficultyBand = 'easy' | 'medium' | 'hard';

export interface TurnMetric {
  turn_index: number;
  timestamp: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
  difficulty: DifficultyBand;
  hesitation_signals: string[];
  scores: {
    argument_strength: number;
    evidence_quality: number;
    logical_consistency: number;
    clarity: number;
    confidence: number;
  };
  trend: 'improving' | 'stable' | 'declining';
}

@Entity('coaching_sessions')
export class CoachingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'thesis_id', type: 'uuid' })
  thesisId!: string;

  @Column({ type: 'text', default: 'mock_viva' })
  mode!: CoachingMode;

  @Column({ name: 'learner_profile', type: 'text', default: 'standard' })
  learnerProfile!: LearnerProfile;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  transcript!: TranscriptMessage[];

  @Column({ name: 'generated_questions', type: 'jsonb', default: () => "'[]'" })
  generatedQuestions!: string[];

  @Column({ name: 'turn_metrics', type: 'jsonb', default: () => "'[]'" })
  turnMetrics!: TurnMetric[];

  @Column({ name: 'readiness_score', type: 'int', nullable: true })
  readinessScore!: number | null;

  @Column({ name: 'weak_topics', type: 'jsonb', default: () => "'[]'" })
  weakTopics!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
