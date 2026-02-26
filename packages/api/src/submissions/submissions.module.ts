import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CitationReport } from '../analysis/entities/citation-report.entity';
import { PlagiarismReport } from '../analysis/entities/plagiarism-report.entity';
import { ThesisAnalysis } from '../analysis/entities/thesis-analysis.entity';
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
    ]),
    StorageModule,
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
