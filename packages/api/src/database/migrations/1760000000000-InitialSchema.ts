import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1760000000000 implements MigrationInterface {
  name = 'InitialSchema1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE users_role_enum AS ENUM ('student', 'professor', 'admin');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE theses_status_enum AS ENUM (
          'draft',
          'supervised',
          'submitted_to_prof',
          'returned_to_student',
          'completed'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE submissions_status_enum AS ENUM ('draft', 'processing', 'complete', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        full_name text NOT NULL,
        role users_role_enum NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        is_verified boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS theses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        supervisor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        supervisor_name text NULL,
        title text NOT NULL,
        abstract text NULL,
        status theses_status_enum NOT NULL DEFAULT 'draft',
        latest_professor_feedback text NULL,
        latest_feedback_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        thesis_id uuid NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
        version_number integer NOT NULL,
        file_key text NOT NULL,
        file_name text NOT NULL,
        extracted_text text NULL,
        status submissions_status_enum NOT NULL DEFAULT 'processing',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_submissions_thesis_version UNIQUE (thesis_id, version_number)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS thesis_analysis (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
        progress_score integer NOT NULL,
        trend_delta integer NOT NULL DEFAULT 0,
        is_first_submission boolean NOT NULL DEFAULT true,
        abstract_alignment_verdict text NOT NULL DEFAULT 'insufficient_data',
        key_topic_coverage jsonb NOT NULL DEFAULT '[]'::jsonb,
        missing_core_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
        structural_readiness text NOT NULL DEFAULT 'developing',
        additions_count integer NOT NULL DEFAULT 0,
        deletions_count integer NOT NULL DEFAULT 0,
        major_edits_count integer NOT NULL DEFAULT 0,
        gaps_resolved integer NOT NULL DEFAULT 0,
        gaps_open integer NOT NULL DEFAULT 0,
        previous_excerpt text NULL,
        current_excerpt text NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS citation_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
        citation_health_score integer NOT NULL,
        issues_count integer NOT NULL,
        missing_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
        broken_references jsonb NOT NULL DEFAULT '[]'::jsonb,
        formatting_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS plagiarism_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
        similarity_percent integer NOT NULL,
        risk_level text NOT NULL,
        flagged_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS coaching_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        thesis_id uuid NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
        transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
        readiness_score integer NULL,
        weak_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS coaching_sessions;');
    await queryRunner.query('DROP TABLE IF EXISTS plagiarism_reports;');
    await queryRunner.query('DROP TABLE IF EXISTS citation_reports;');
    await queryRunner.query('DROP TABLE IF EXISTS thesis_analysis;');
    await queryRunner.query('DROP TABLE IF EXISTS submissions;');
    await queryRunner.query('DROP TABLE IF EXISTS theses;');
    await queryRunner.query('DROP TABLE IF EXISTS password_resets;');
    await queryRunner.query('DROP TABLE IF EXISTS users;');

    await queryRunner.query('DROP TYPE IF EXISTS submissions_status_enum;');
    await queryRunner.query('DROP TYPE IF EXISTS theses_status_enum;');
    await queryRunner.query('DROP TYPE IF EXISTS users_role_enum;');
  }
}
