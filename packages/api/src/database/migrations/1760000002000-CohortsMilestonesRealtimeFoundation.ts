import { MigrationInterface, QueryRunner } from 'typeorm';

export class CohortsMilestonesRealtimeFoundation1760000002000 implements MigrationInterface {
  name = 'CohortsMilestonesRealtimeFoundation1760000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cohorts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        professor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        citation_style text NOT NULL DEFAULT 'APA',
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_cohorts_professor_name UNIQUE (professor_id, name)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cohorts_professor_id
      ON cohorts (professor_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        enrolled_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_enrollments_student_cohort UNIQUE (student_id, cohort_id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollments_cohort_id
      ON enrollments (cohort_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollments_student_id
      ON enrollments (student_id);
    `);

    await queryRunner.query(`
      INSERT INTO cohorts (professor_id, name, citation_style)
      SELECT DISTINCT t.supervisor_id, 'Default Cohort', 'APA'
      FROM theses t
      WHERE t.supervisor_id IS NOT NULL
      ON CONFLICT (professor_id, name) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO enrollments (student_id, cohort_id)
      SELECT t.student_id, c.id
      FROM theses t
      INNER JOIN cohorts c
        ON c.professor_id = t.supervisor_id
       AND c.name = 'Default Cohort'
      WHERE t.supervisor_id IS NOT NULL
      ON CONFLICT (student_id, cohort_id) DO NOTHING;
    `);

    await queryRunner.query(`
      ALTER TABLE milestones
      ADD COLUMN IF NOT EXISTS cohort_id uuid;
    `);

    await queryRunner.query(`
      INSERT INTO cohorts (professor_id, name, citation_style)
      SELECT DISTINCT m.professor_id, 'Default Cohort', 'APA'
      FROM milestones m
      WHERE m.professor_id IS NOT NULL
      ON CONFLICT (professor_id, name) DO NOTHING;
    `);

    await queryRunner.query(`
      UPDATE milestones m
      SET cohort_id = c.id
      FROM cohorts c
      WHERE m.cohort_id IS NULL
        AND c.professor_id = m.professor_id
        AND c.name = 'Default Cohort';
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'milestones'
            AND column_name = 'professor_id'
        ) THEN
          IF EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE constraint_name = 'milestones_professor_id_fkey'
              AND table_name = 'milestones'
          ) THEN
            ALTER TABLE milestones DROP CONSTRAINT milestones_professor_id_fkey;
          END IF;

          ALTER TABLE milestones DROP COLUMN professor_id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'milestones'
            AND constraint_name = 'fk_milestones_cohort_id'
        ) THEN
          ALTER TABLE milestones
            ADD CONSTRAINT fk_milestones_cohort_id
            FOREIGN KEY (cohort_id)
            REFERENCES cohorts(id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM milestones WHERE cohort_id IS NULL) THEN
          ALTER TABLE milestones ALTER COLUMN cohort_id SET NOT NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_milestones_professor_due_date;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_milestones_cohort_due_date
      ON milestones (cohort_id, due_date);
    `);

    await queryRunner.query(`
      ALTER TABLE submissions
      ADD COLUMN IF NOT EXISTS milestone_id uuid NULL;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'submissions'
            AND constraint_name = 'fk_submissions_milestone_id'
        ) THEN
          ALTER TABLE submissions
            ADD CONSTRAINT fk_submissions_milestone_id
            FOREIGN KEY (milestone_id)
            REFERENCES milestones(id)
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_milestone_id
      ON submissions (milestone_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_milestone_status
      ON submissions (milestone_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_submissions_milestone_status;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_submissions_milestone_id;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'submissions'
            AND constraint_name = 'fk_submissions_milestone_id'
        ) THEN
          ALTER TABLE submissions DROP CONSTRAINT fk_submissions_milestone_id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE submissions
      DROP COLUMN IF EXISTS milestone_id;
    `);

    await queryRunner.query(`
      ALTER TABLE milestones
      ADD COLUMN IF NOT EXISTS professor_id uuid;
    `);

    await queryRunner.query(`
      UPDATE milestones m
      SET professor_id = c.professor_id
      FROM cohorts c
      WHERE c.id = m.cohort_id;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'milestones'
            AND constraint_name = 'milestones_professor_id_fkey'
        ) THEN
          ALTER TABLE milestones
            ADD CONSTRAINT milestones_professor_id_fkey
            FOREIGN KEY (professor_id)
            REFERENCES users(id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_milestones_cohort_due_date;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'milestones'
            AND constraint_name = 'fk_milestones_cohort_id'
        ) THEN
          ALTER TABLE milestones DROP CONSTRAINT fk_milestones_cohort_id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE milestones
      DROP COLUMN IF EXISTS cohort_id;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_milestones_professor_due_date
      ON milestones (professor_id, due_date);
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_enrollments_student_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_enrollments_cohort_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_cohorts_professor_id;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS enrollments;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS cohorts;
    `);
  }
}
