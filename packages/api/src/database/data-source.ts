import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { CitationReport } from '../analysis/entities/citation-report.entity';
import { PlagiarismReport } from '../analysis/entities/plagiarism-report.entity';
import { ThesisAnalysis } from '../analysis/entities/thesis-analysis.entity';
import { CoachingSession } from '../coaching/entities/coaching-session.entity';
import { Cohort } from '../cohorts/entities/cohort.entity';
import { Enrollment } from '../cohorts/entities/enrollment.entity';
import { PasswordReset } from '../auth/entities/password-reset.entity';
import { Milestone } from '../milestones/entities/milestone.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Thesis } from '../theses/entities/thesis.entity';
import { User } from '../users/user.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  logging: false,
  entities: [
    User,
    PasswordReset,
    Thesis,
    Submission,
    ThesisAnalysis,
    CitationReport,
    PlagiarismReport,
    CoachingSession,
    Cohort,
    Enrollment,
    Milestone,
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
});

export default AppDataSource;
