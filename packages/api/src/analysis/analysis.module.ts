import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Submission } from '../submissions/entities/submission.entity';
import { Thesis } from '../theses/entities/thesis.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { CitationReport } from './entities/citation-report.entity';
import { PlagiarismReport } from './entities/plagiarism-report.entity';
import { ThesisAnalysis } from './entities/thesis-analysis.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Thesis,
      Submission,
      ThesisAnalysis,
      CitationReport,
      PlagiarismReport,
    ]),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
