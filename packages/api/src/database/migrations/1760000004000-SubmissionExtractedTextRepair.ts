import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repairs legacy submissions text column naming mismatches.
 *
 * Expected canonical column: submissions.extracted_text
 * Possible legacy columns seen in older environments:
 *   - "extractedText"
 *   - extractedtext
 */
export class SubmissionExtractedTextRepair1760000004000 implements MigrationInterface {
  name = 'SubmissionExtractedTextRepair1760000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        -- If canonical column is missing, try rename from legacy names first.
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'submissions'
            AND column_name = 'extracted_text'
        ) THEN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'submissions'
              AND column_name = 'extractedText'
          ) THEN
            ALTER TABLE submissions RENAME COLUMN "extractedText" TO extracted_text;
          ELSIF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'submissions'
              AND column_name = 'extractedtext'
          ) THEN
            ALTER TABLE submissions RENAME COLUMN extractedtext TO extracted_text;
          ELSE
            ALTER TABLE submissions ADD COLUMN extracted_text text NULL;
          END IF;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        -- Backfill from legacy camelCase column if both columns exist.
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'submissions'
            AND column_name = 'extracted_text'
        ) AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'submissions'
            AND column_name = 'extractedText'
        ) THEN
          UPDATE submissions
          SET extracted_text = COALESCE(extracted_text, "extractedText")
          WHERE "extractedText" IS NOT NULL;
        END IF;

        -- Backfill from legacy lowercase column if both columns exist.
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'submissions'
            AND column_name = 'extracted_text'
        ) AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'submissions'
            AND column_name = 'extractedtext'
        ) THEN
          UPDATE submissions
          SET extracted_text = COALESCE(extracted_text, extractedtext)
          WHERE extractedtext IS NOT NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Intentionally no-op to avoid destructive rollback of thesis text content.
      SELECT 1;
    `);
  }
}
