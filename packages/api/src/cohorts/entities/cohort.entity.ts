import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('cohorts')
export class Cohort {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'professor_id', type: 'uuid' })
  professorId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'citation_style', type: 'text', default: 'APA' })
  citationStyle!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
