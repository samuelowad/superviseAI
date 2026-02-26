import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CitationReport } from './entities/citation-report.entity';
import { PlagiarismReport } from './entities/plagiarism-report.entity';
import { ThesisAnalysis } from './entities/thesis-analysis.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Thesis } from '../theses/entities/thesis.entity';

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(Thesis)
    private readonly thesisRepository: Repository<Thesis>,
    @InjectRepository(Submission)
    private readonly submissionRepository: Repository<Submission>,
    @InjectRepository(ThesisAnalysis)
    private readonly thesisAnalysisRepository: Repository<ThesisAnalysis>,
    @InjectRepository(CitationReport)
    private readonly citationReportRepository: Repository<CitationReport>,
    @InjectRepository(PlagiarismReport)
    private readonly plagiarismReportRepository: Repository<PlagiarismReport>,
  ) {}

  async getFullAnalysis(studentId: string, submissionId: string): Promise<Record<string, unknown>> {
    const submission = await this.submissionRepository.findOne({ where: { id: submissionId } });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }

    const thesis = await this.thesisRepository.findOne({
      where: {
        id: submission.thesisId,
        studentId,
      },
    });

    if (!thesis) {
      throw new NotFoundException('Submission not found for this student.');
    }

    const [thesisAnalysis, citationReport, plagiarismReport] = await Promise.all([
      this.thesisAnalysisRepository.findOne({ where: { submissionId } }),
      this.citationReportRepository.findOne({ where: { submissionId } }),
      this.plagiarismReportRepository.findOne({ where: { submissionId } }),
    ]);

    return {
      submission,
      thesis_analysis: thesisAnalysis,
      citation_report: citationReport,
      plagiarism_report: plagiarismReport,
    };
  }
}
