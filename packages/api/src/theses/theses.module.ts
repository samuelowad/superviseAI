import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CitationReport } from '../analysis/entities/citation-report.entity';
import { PlagiarismReport } from '../analysis/entities/plagiarism-report.entity';
import { ThesisAnalysis } from '../analysis/entities/thesis-analysis.entity';
import { CoachingSession } from '../coaching/entities/coaching-session.entity';
import { CohortsModule } from '../cohorts/cohorts.module';
import { Submission } from '../submissions/entities/submission.entity';
import { User } from '../users/user.entity';
import { Thesis } from './entities/thesis.entity';
import { ThesesController } from './theses.controller';
import { ThesesService } from './theses.service';

@Module({
  imports: [
    CohortsModule,
    TypeOrmModule.forFeature([
      Thesis,
      Submission,
      ThesisAnalysis,
      CitationReport,
      PlagiarismReport,
      CoachingSession,
      User,
    ]),
  ],
  controllers: [ThesesController],
  providers: [ThesesService],
  exports: [ThesesService, TypeOrmModule],
})
export class ThesesModule {}
