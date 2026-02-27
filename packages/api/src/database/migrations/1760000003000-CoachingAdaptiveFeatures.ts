import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds adaptive coaching columns to coaching_sessions:
 *   - mode               (mock_viva | argument_defender | socratic)
 *   - generated_questions (AI-generated thesis-specific question list)
 *   - learner_profile    (standard | esl_support | anxious_speaker | advanced_researcher)
 *   - turn_metrics       (per-turn confidence, sentiment, dimension scores)
 */
export class CoachingAdaptiveFeatures1760000003000 implements MigrationInterface {
  name = 'CoachingAdaptiveFeatures1760000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE coaching_sessions
        ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'mock_viva',
        ADD COLUMN IF NOT EXISTS generated_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS learner_profile text NOT NULL DEFAULT 'standard',
        ADD COLUMN IF NOT EXISTS turn_metrics jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE coaching_sessions
        DROP COLUMN IF EXISTS turn_metrics,
        DROP COLUMN IF EXISTS learner_profile,
        DROP COLUMN IF EXISTS generated_questions,
        DROP COLUMN IF EXISTS mode;
    `);
  }
}
