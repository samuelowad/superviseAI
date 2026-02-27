import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('enrollments')
export class Enrollment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'student_id', type: 'uuid' })
  studentId!: string;

  @Column({ name: 'cohort_id', type: 'uuid' })
  cohortId!: string;

  @CreateDateColumn({ name: 'enrolled_at' })
  enrolledAt!: Date;
}
