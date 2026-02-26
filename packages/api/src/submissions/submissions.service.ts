import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createRequire } from 'module';
import { Repository } from 'typeorm';

import { CitationReport } from '../analysis/entities/citation-report.entity';
import { PlagiarismReport } from '../analysis/entities/plagiarism-report.entity';
import { ThesisAnalysis } from '../analysis/entities/thesis-analysis.entity';
import { StorageService } from '../storage/storage.service';
import { Thesis, ThesisStatus } from '../theses/entities/thesis.entity';
import { Submission, SubmissionStatus } from './entities/submission.entity';

interface UploadedFileData {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const runtimeRequire = createRequire(__filename);

@Injectable()
export class SubmissionsService {
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
    private readonly storageService: StorageService,
  ) {}

  async upload(
    studentId: string,
    file: UploadedFileData,
  ): Promise<{ submission_id: string; status: string }> {
    const thesis = await this.thesisRepository.findOne({ where: { studentId } });
    if (!thesis) {
      throw new BadRequestException('Create a thesis proposal before uploading a version.');
    }

    this.validateFile(file);

    const previousSubmission = await this.submissionRepository.findOne({
      where: { thesisId: thesis.id },
      order: { versionNumber: 'DESC' },
    });

    const versionNumber = (previousSubmission?.versionNumber ?? 0) + 1;
    const extension = file.mimetype.includes('pdf') ? 'pdf' : 'docx';
    const fileKey = `theses/${thesis.id}/${versionNumber}.${extension}`;

    const submission = this.submissionRepository.create({
      thesisId: thesis.id,
      versionNumber,
      fileKey,
      fileName: file.originalname,
      extractedText: null,
      status: SubmissionStatus.PROCESSING,
    });
    await this.submissionRepository.save(submission);

    try {
      await this.storageService.uploadFile(file.buffer, fileKey, file.mimetype);

      const extractedText = await this.extractText(file);
      submission.extractedText = extractedText;

      const previousAnalysis = previousSubmission
        ? await this.thesisAnalysisRepository.findOne({
            where: { submissionId: previousSubmission.id },
          })
        : null;

      const analysis = this.buildAnalysis({
        currentText: extractedText,
        previousText: previousSubmission?.extractedText ?? null,
        thesisAbstract: thesis.abstract,
        previousProgress: previousAnalysis?.progressScore ?? null,
        versionNumber,
      });

      const citation = this.buildCitationReport(extractedText);
      const plagiarism = this.buildPlagiarismReport(extractedText);

      await this.thesisAnalysisRepository.save(
        this.thesisAnalysisRepository.create({
          submissionId: submission.id,
          ...analysis,
        }),
      );

      await this.citationReportRepository.save(
        this.citationReportRepository.create({
          submissionId: submission.id,
          ...citation,
        }),
      );

      await this.plagiarismReportRepository.save(
        this.plagiarismReportRepository.create({
          submissionId: submission.id,
          ...plagiarism,
        }),
      );

      submission.status = SubmissionStatus.COMPLETE;
      await this.submissionRepository.save(submission);

      thesis.status = ThesisStatus.SUPERVISED;
      await this.thesisRepository.save(thesis);

      return {
        submission_id: submission.id,
        status: submission.status,
      };
    } catch (error) {
      submission.status = SubmissionStatus.FAILED;
      await this.submissionRepository.save(submission);
      throw error;
    }
  }

  async getOne(studentId: string, submissionId: string): Promise<Record<string, unknown>> {
    const submission = await this.submissionRepository.findOne({ where: { id: submissionId } });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }

    const thesis = await this.thesisRepository.findOne({
      where: { id: submission.thesisId, studentId },
    });
    if (!thesis) {
      throw new NotFoundException('Submission not found for this student.');
    }

    const [analysis, citation, plagiarism] = await Promise.all([
      this.thesisAnalysisRepository.findOne({ where: { submissionId: submission.id } }),
      this.citationReportRepository.findOne({ where: { submissionId: submission.id } }),
      this.plagiarismReportRepository.findOne({ where: { submissionId: submission.id } }),
    ]);

    return {
      id: submission.id,
      thesis_id: submission.thesisId,
      version_number: submission.versionNumber,
      status: submission.status,
      analysis,
      citation,
      plagiarism,
      created_at: submission.createdAt,
    };
  }

  private validateFile(file: UploadedFileData): void {
    const acceptedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!acceptedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF and DOCX files are supported.');
    }

    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('Maximum file size is 20MB.');
    }
  }

  private async extractText(file: UploadedFileData): Promise<string> {
    if (file.mimetype === 'application/pdf') {
      const pdfText = await this.extractPdfText(file.buffer);
      if (pdfText) {
        return pdfText;
      }

      return 'PDF text extraction is unavailable in this environment. Install pdf-parse to enable semantic PDF diff.';
    }

    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const docxText = await this.extractDocxText(file.buffer);
      if (docxText) {
        return docxText;
      }

      return 'DOCX text extraction is unavailable in this environment. Install mammoth to enable semantic DOCX diff.';
    }

    return this.extractHeuristicText(file);
  }

  private async extractPdfText(buffer: Buffer): Promise<string | null> {
    try {
      // Optional runtime dependency until all environments install parser packages.
      const pdfParseModule = runtimeRequire('pdf-parse');
      const pdfParse = (pdfParseModule.default ?? pdfParseModule) as (
        source: Buffer,
      ) => Promise<{ text?: string }>;

      const parsed = await pdfParse(buffer);
      const text = parsed.text?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length >= 40) {
        return text.slice(0, 120000);
      }
      return null;
    } catch {
      return null;
    }
  }

  private async extractDocxText(buffer: Buffer): Promise<string | null> {
    try {
      // Optional runtime dependency until all environments install parser packages.
      const mammothModule = runtimeRequire('mammoth');
      const mammoth = (mammothModule.default ?? mammothModule) as {
        extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
      };

      const parsed = await mammoth.extractRawText({ buffer });
      const text = parsed.value?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length >= 40) {
        return text.slice(0, 120000);
      }
      return null;
    } catch {
      return null;
    }
  }

  private extractHeuristicText(file: UploadedFileData): string {
    const raw = file.buffer.toString('utf8');
    if (this.isLikelyBinary(raw)) {
      return 'Unable to extract readable text from this file format.';
    }

    const textFromBuffer = raw
      .replace(/\r\n/g, '\n')
      .replace(/[^\t\n\r -~]/g, ' ')
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join('\n');

    if (textFromBuffer.length > 80) {
      return textFromBuffer.slice(0, 120000);
    }

    return `Extracted content placeholder for ${file.originalname}.`;
  }

  private isLikelyBinary(text: string): boolean {
    if (!text) {
      return true;
    }

    let nonPrintable = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      const isPrintableAscii =
        code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
      if (!isPrintableAscii) {
        nonPrintable += 1;
      }
    }

    return nonPrintable / text.length > 0.22;
  }

  private buildAnalysis(input: {
    currentText: string;
    previousText: string | null;
    thesisAbstract: string | null;
    previousProgress: number | null;
    versionNumber: number;
  }): Omit<ThesisAnalysis, 'id' | 'submissionId' | 'createdAt'> {
    const sections = [
      'introduction',
      'methodology',
      'results',
      'discussion',
      'conclusion',
      'references',
    ];
    const currentLower = input.currentText.toLowerCase();

    const missingCoreSections = sections.filter((section) => !currentLower.includes(section));
    const coveredSections = sections
      .filter((section) => currentLower.includes(section))
      .slice(0, 4);

    const baseScore = Math.min(
      92,
      45 + Math.round(input.currentText.length / 1200) + coveredSections.length * 5,
    );
    const progressScore = Math.max(35, baseScore);
    const trendDelta = input.previousProgress ? progressScore - input.previousProgress : 0;

    const previousText = input.previousText ?? '';
    const diff = this.calculateDiff(previousText, input.currentText);

    const abstractVerdict = this.calculateAbstractVerdict(input.currentText, input.thesisAbstract);

    return {
      progressScore,
      trendDelta,
      isFirstSubmission: input.versionNumber === 1,
      abstractAlignmentVerdict: abstractVerdict,
      keyTopicCoverage: coveredSections,
      missingCoreSections,
      structuralReadiness:
        missingCoreSections.length <= 1
          ? 'strong'
          : missingCoreSections.length <= 3
            ? 'moderate'
            : 'developing',
      additionsCount: diff.additions,
      deletionsCount: diff.deletions,
      majorEditsCount: diff.majorEdits,
      gapsResolved: Math.max(
        0,
        (input.previousText ? 2 : 0) + coveredSections.length - missingCoreSections.length,
      ),
      gapsOpen: missingCoreSections.length,
      previousExcerpt: input.previousText ? input.previousText.slice(0, 1500) : null,
      currentExcerpt: input.currentText.slice(0, 1500),
    };
  }

  private buildCitationReport(
    text: string,
  ): Omit<CitationReport, 'id' | 'submissionId' | 'createdAt'> {
    const authorYearMatches = text.match(/\([A-Z][A-Za-z]+,\s*\d{4}\)/g) ?? [];
    const numericMatches = text.match(/\[\d+(?:-\d+)?\]/g) ?? [];

    const citationCount = authorYearMatches.length + numericMatches.length;
    const hasReferenceSection = /references|bibliography/i.test(text);

    const missingCitations = citationCount === 0 ? ['No in-text citations detected.'] : [];
    const brokenReferences = hasReferenceSection ? [] : ['Reference section not detected.'];
    const formattingErrors = /et al\./i.test(text)
      ? []
      : ['Could not confidently detect standard citation formatting cues.'];

    const issuesCount = missingCitations.length + brokenReferences.length + formattingErrors.length;
    const citationHealthScore = Math.max(45, 100 - issuesCount * 15);

    return {
      citationHealthScore,
      issuesCount,
      missingCitations,
      brokenReferences,
      formattingErrors,
    };
  }

  private buildPlagiarismReport(
    text: string,
  ): Omit<PlagiarismReport, 'id' | 'submissionId' | 'createdAt'> {
    const sentences = text
      .split(/[.!?]/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 24);

    const counts = new Map<string, number>();
    for (const sentence of sentences) {
      counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
    }

    const repeated = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([sentence]) => sentence);

    const similarityPercent = Math.min(68, 8 + repeated.length * 6);
    const riskLevel: 'green' | 'yellow' | 'red' =
      similarityPercent < 20 ? 'green' : similarityPercent < 40 ? 'yellow' : 'red';

    return {
      similarityPercent,
      riskLevel,
      flaggedSections: repeated.slice(0, 5),
    };
  }

  private calculateDiff(
    previousText: string,
    currentText: string,
  ): {
    additions: number;
    deletions: number;
    majorEdits: number;
  } {
    if (!previousText) {
      const additions = Math.max(1, Math.round(currentText.length / 160));
      return {
        additions,
        deletions: 0,
        majorEdits: Math.max(1, Math.round(additions * 0.2)),
      };
    }

    const previousLines = previousText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const currentLines = currentText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const previousSet = new Set(previousLines);
    const currentSet = new Set(currentLines);

    const additions = currentLines.filter((line) => !previousSet.has(line)).length;
    const deletions = previousLines.filter((line) => !currentSet.has(line)).length;
    const majorEdits = Math.round(Math.min(additions, deletions) * 0.35);

    return { additions, deletions, majorEdits };
  }

  private calculateAbstractVerdict(text: string, thesisAbstract: string | null): string {
    if (!thesisAbstract || thesisAbstract.trim().length < 20) {
      return 'insufficient_data';
    }

    const abstractTokens = new Set(
      thesisAbstract
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 4),
    );

    if (abstractTokens.size === 0) {
      return 'insufficient_data';
    }

    let matched = 0;
    for (const token of abstractTokens) {
      if (text.toLowerCase().includes(token)) {
        matched += 1;
      }
    }

    const ratio = matched / abstractTokens.size;

    if (ratio >= 0.55) {
      return 'on_track';
    }

    if (ratio >= 0.3) {
      return 'partially_aligned';
    }

    return 'needs_realignment';
  }
}
