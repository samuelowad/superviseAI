import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('milestones')
export class Milestone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'cohort_id', type: 'uuid' })
  cohortId!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', default: 'draft_review' })
  stage!: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
