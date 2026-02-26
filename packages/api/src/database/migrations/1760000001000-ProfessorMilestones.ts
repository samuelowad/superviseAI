import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProfessorMilestones1760000001000 implements MigrationInterface {
  name = 'ProfessorMilestones1760000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS milestones (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        professor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title text NOT NULL,
        stage text NOT NULL DEFAULT 'draft_review',
        due_date date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_milestones_professor_due_date
      ON milestones (professor_id, due_date);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_milestones_professor_due_date;');
    await queryRunner.query('DROP TABLE IF EXISTS milestones;');
  }
}
