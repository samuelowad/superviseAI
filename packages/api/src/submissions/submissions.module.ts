import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CitationReport } from '../analysis/entities/citation-report.entity';
import { PlagiarismReport } from '../analysis/entities/plagiarism-report.entity';
import { ThesisAnalysis } from '../analysis/entities/thesis-analysis.entity';
import { CohortsModule } from '../cohorts/cohorts.module';
import { AzureModule } from '../integrations/azure/azure.module';
import { CopyleaksModule } from '../integrations/copyleaks/copyleaks.module';
import { SemanticScholarModule } from '../integrations/semanticscholar/semanticscholar.module';
import { Milestone } from '../milestones/entities/milestone.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { StorageModule } from '../storage/storage.module';
import { Thesis } from '../theses/entities/thesis.entity';
import { Submission } from './entities/submission.entity';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Thesis,
      Submission,
      ThesisAnalysis,
      CitationReport,
      PlagiarismReport,
      Milestone,
    ]),
    StorageModule,
    CohortsModule,
    RealtimeModule,
    AzureModule,
    CopyleaksModule,
    SemanticScholarModule,
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
