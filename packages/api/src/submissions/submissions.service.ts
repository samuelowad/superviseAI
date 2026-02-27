import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createRequire } from 'module';
import { Repository } from 'typeorm';

import { CitationReport } from '../analysis/entities/citation-report.entity';
import { PlagiarismReport } from '../analysis/entities/plagiarism-report.entity';
import { ThesisAnalysis } from '../analysis/entities/thesis-analysis.entity';
import { CohortsService } from '../cohorts/cohorts.service';
import { AzureOpenAiService } from '../integrations/azure/azure-openai.service';
import { CopyleaksService } from '../integrations/copyleaks/copyleaks.service';
import { SemanticScholarService } from '../integrations/semanticscholar/semanticscholar.service';
import { Milestone } from '../milestones/entities/milestone.entity';
import { RealtimeService } from '../realtime/realtime.service';
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
  private readonly logger = new Logger(SubmissionsService.name);

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
    @InjectRepository(Milestone)
    private readonly milestoneRepository: Repository<Milestone>,
    private readonly storageService: StorageService,
    private readonly cohortsService: CohortsService,
    private readonly realtimeService: RealtimeService,
    private readonly azureOpenAi: AzureOpenAiService,
    private readonly copyleaks: CopyleaksService,
    private readonly semanticScholar: SemanticScholarService,
  ) {}

  async upload(
    studentId: string,
    file: UploadedFileData,
    milestoneId?: string,
  ): Promise<{ submission_id: string; status: string }> {
    const thesis = await this.thesisRepository.findOne({ where: { studentId } });
    if (!thesis) {
      throw new BadRequestException('Create a thesis proposal before uploading a version.');
    }

    this.validateFile(file);

    const milestone = milestoneId
      ? await this.milestoneRepository.findOne({ where: { id: milestoneId } })
      : null;
    if (milestoneId && !milestone) {
      throw new BadRequestException('Milestone not found.');
    }

    if (milestone) {
      const isEnrolled = await this.cohortsService.isStudentEnrolledInCohort(
        studentId,
        milestone.cohortId,
      );
      if (!isEnrolled) {
        throw new BadRequestException('Student is not enrolled in the selected milestone cohort.');
      }
    }

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
      milestoneId: milestone?.id ?? null,
      extractedText: null,
      status: SubmissionStatus.PROCESSING,
    });
    await this.submissionRepository.save(submission);

    this.realtimeService.emitToUser(studentId, 'submission.created', {
      submissionId: submission.id,
      studentId,
      status: submission.status,
      versionNumber: submission.versionNumber,
      submittedAt: submission.createdAt.toISOString(),
      milestoneId: submission.milestoneId,
    });

    try {
      await this.storageService.uploadFile(file.buffer, fileKey, file.mimetype);
      this.realtimeService.emitToUser(studentId, 'submission.stage', {
        submissionId: submission.id,
        stage: 'stored_file',
        message: 'File uploaded successfully.',
        progress: 0.1,
      });

      const extractedText = await this.extractText(file);
      submission.extractedText = extractedText;
      await this.submissionRepository.save(submission);
      this.realtimeService.emitToUser(studentId, 'submission.stage', {
        submissionId: submission.id,
        stage: 'text_extracted',
        message: 'Text extracted and ready for analysis.',
        progress: 0.25,
      });

      const previousAnalysis = previousSubmission
        ? await this.thesisAnalysisRepository.findOne({
            where: { submissionId: previousSubmission.id },
          })
        : null;

      // --- Thesis Analysis: AI-powered (with heuristic fallback) ---
      const analysis = await this.buildAnalysis({
        currentText: extractedText,
        previousText: previousSubmission?.extractedText ?? null,
        thesisAbstract: thesis.abstract,
        previousProgress: previousAnalysis?.progressScore ?? null,
        versionNumber,
      });

      await this.thesisAnalysisRepository.save(
        this.thesisAnalysisRepository.create({
          submissionId: submission.id,
          ...analysis,
        }),
      );
      this.realtimeService.emitToUser(studentId, 'submission.stage', {
        submissionId: submission.id,
        stage: 'thesis_analysis_done',
        message: 'Thesis analysis complete.',
        progress: 0.6,
      });

      // --- Citation Validation: 3-layer pipeline ---
      const citation = await this.buildCitationReport(extractedText);
      await this.citationReportRepository.save(
        this.citationReportRepository.create({
          submissionId: submission.id,
          ...citation,
        }),
      );
      this.realtimeService.emitToUser(studentId, 'submission.stage', {
        submissionId: submission.id,
        stage: 'citations_done',
        message: 'Citation scan complete.',
        progress: 0.8,
      });

      // --- Plagiarism: async Copyleaks scan (or heuristic fallback) ---
      const webhookBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
      const plagiarismInitial = await this.buildPlagiarismReport(
        extractedText,
        submission.id,
        webhookBase,
      );
      await this.plagiarismReportRepository.save(
        this.plagiarismReportRepository.create({
          submissionId: submission.id,
          ...plagiarismInitial,
        }),
      );
      this.realtimeService.emitToUser(studentId, 'submission.stage', {
        submissionId: submission.id,
        stage: 'plagiarism_done',
        message: plagiarismInitial.flaggedSections.includes('__pending__')
          ? 'Plagiarism scan started (results arriving shortly).'
          : 'Plagiarism scan complete.',
        progress: 0.95,
      });

      submission.status = SubmissionStatus.COMPLETE;
      await this.submissionRepository.save(submission);
      this.realtimeService.emitToUser(studentId, 'submission.complete', {
        submissionId: submission.id,
        status: submission.status,
      });

      const professorIds = new Set<string>();
      const enrolledProfessorIds = await this.cohortsService.getProfessorIdsForStudent(studentId);
      for (const professorId of enrolledProfessorIds) {
        professorIds.add(professorId);
      }
      if (thesis.supervisorId) {
        professorIds.add(thesis.supervisorId);
      }

      const originalityScore = Math.max(0, 100 - plagiarismInitial.similarityPercent);
      const isPending = plagiarismInitial.flaggedSections.includes('__pending__');

      if (!isPending) {
        // Emit plagiarism.ready now since it was synchronous (heuristic)
        for (const professorId of professorIds) {
          this.realtimeService.emitToProfessor(professorId, 'plagiarism.ready', {
            submissionId: submission.id,
            originalityScore,
            scoreDropped: plagiarismInitial.similarityPercent >= 30,
          });
        }
        this.realtimeService.emitToUser(studentId, 'plagiarism.ready', {
          submissionId: submission.id,
          originalityScore,
          scoreDropped: plagiarismInitial.similarityPercent >= 30,
        });
      }

      for (const professorId of professorIds) {
        this.realtimeService.emitToProfessor(professorId, 'dashboard.student_update', {
          studentId,
          submissionId: submission.id,
          progressScore: analysis.progressScore,
          atRisk: analysis.progressScore < 55 || plagiarismInitial.similarityPercent >= 30,
        });
      }

      thesis.status = ThesisStatus.SUPERVISED;
      await this.thesisRepository.save(thesis);

      return {
        submission_id: submission.id,
        status: submission.status,
      };
    } catch (error) {
      submission.status = SubmissionStatus.FAILED;
      await this.submissionRepository.save(submission);
      this.realtimeService.emitToUser(studentId, 'submission.failed', {
        submissionId: submission.id,
        status: submission.status,
        error: 'Submission processing failed.',
      });
      throw error;
    }
  }

  async streamFile(
    studentId: string,
    submissionId: string,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
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

    const { buffer, contentType } = await this.storageService.getFileBuffer(submission.fileKey);

    return { buffer, contentType, filename: submission.fileName };
  }

  async streamFileForProfessor(
    professorId: string,
    submissionId: string,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const submission = await this.submissionRepository.findOne({ where: { id: submissionId } });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }

    const thesis = await this.thesisRepository.findOne({ where: { id: submission.thesisId } });
    if (!thesis) {
      throw new NotFoundException('Submission not found for this professor.');
    }

    if (thesis.supervisorId !== professorId) {
      const hasScope = await this.cohortsService.isStudentInProfessorScope(
        professorId,
        thesis.studentId,
      );
      if (!hasScope) {
        throw new NotFoundException('Submission not found for this professor.');
      }
    }

    const { buffer, contentType } = await this.storageService.getFileBuffer(submission.fileKey);

    return { buffer, contentType, filename: submission.fileName };
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
      milestone_id: submission.milestoneId,
      version_number: submission.versionNumber,
      status: submission.status,
      analysis,
      citation,
      plagiarism,
      created_at: submission.createdAt,
    };
  }

  /**
   * Called by the Copyleaks webhook handler when a scan completes.
   */
  async handleCopyleaksWebhook(
    submissionId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const report = await this.plagiarismReportRepository.findOne({
      where: { submissionId },
    });
    if (!report) {
      this.logger.warn(`Copyleaks webhook received for unknown submission: ${submissionId}`);
      return;
    }

    const parsed = this.copyleaks.parseWebhookResult(payload);
    if (!parsed) {
      this.logger.warn(`Could not parse Copyleaks webhook for submission: ${submissionId}`);
      return;
    }

    report.similarityPercent = parsed.similarityPercent;
    report.riskLevel = parsed.riskLevel;
    report.flaggedSections = parsed.flaggedSections;
    await this.plagiarismReportRepository.save(report);

    // Find thesis and student to emit socket events
    const submission = await this.submissionRepository.findOne({ where: { id: submissionId } });
    if (!submission) return;

    const thesis = await this.thesisRepository.findOne({ where: { id: submission.thesisId } });
    if (!thesis) return;

    const originalityScore = Math.max(0, 100 - parsed.similarityPercent);
    this.realtimeService.emitToUser(thesis.studentId, 'plagiarism.ready', {
      submissionId,
      originalityScore,
      scoreDropped: parsed.similarityPercent >= 30,
    });

    if (thesis.supervisorId) {
      this.realtimeService.emitToProfessor(thesis.supervisorId, 'plagiarism.ready', {
        submissionId,
        originalityScore,
        scoreDropped: parsed.similarityPercent >= 30,
      });
    }

    this.logger.log(
      `Copyleaks webhook processed for ${submissionId}: ${parsed.similarityPercent}% similarity`,
    );
  }

  // ─── Private pipeline methods ────────────────────────────────────────────

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

  /**
   * Build thesis analysis: AI-powered with heuristic fallback.
   */
  private async buildAnalysis(input: {
    currentText: string;
    previousText: string | null;
    thesisAbstract: string | null;
    previousProgress: number | null;
    versionNumber: number;
  }): Promise<Omit<ThesisAnalysis, 'id' | 'submissionId' | 'createdAt'>> {
    const diff = this.calculateDiff(input.previousText ?? '', input.currentText);

    // Try AI analysis first
    if (this.azureOpenAi.isAvailable()) {
      const aiResult = await this.azureOpenAi.analyzeThesis({
        currentText: input.currentText,
        abstract: input.thesisAbstract,
        previousText: input.previousText,
        versionNumber: input.versionNumber,
      });

      if (aiResult) {
        return {
          progressScore: aiResult.progress_score,
          trendDelta: aiResult.trend_delta,
          isFirstSubmission: input.versionNumber === 1,
          abstractAlignmentVerdict: aiResult.abstract_alignment_verdict,
          keyTopicCoverage: aiResult.key_topic_coverage,
          missingCoreSections: aiResult.missing_core_sections,
          structuralReadiness: aiResult.structural_readiness,
          additionsCount: diff.additions,
          deletionsCount: diff.deletions,
          majorEditsCount: diff.majorEdits,
          gapsResolved: Math.max(
            0,
            aiResult.key_topic_coverage.length - aiResult.missing_core_sections.length,
          ),
          gapsOpen: aiResult.missing_core_sections.length + aiResult.gap_report.length,
          previousExcerpt: input.previousText ? input.previousText.slice(0, 1500) : null,
          currentExcerpt: input.currentText.slice(0, 1500),
        };
      }
    }

    // Heuristic fallback
    return this.buildAnalysisHeuristic(input, diff);
  }

  private buildAnalysisHeuristic(
    input: {
      currentText: string;
      previousText: string | null;
      thesisAbstract: string | null;
      previousProgress: number | null;
      versionNumber: number;
    },
    diff: { additions: number; deletions: number; majorEdits: number },
  ): Omit<ThesisAnalysis, 'id' | 'submissionId' | 'createdAt'> {
    const sections = [
      'introduction',
      'methodology',
      'results',
      'discussion',
      'conclusion',
      'references',
    ];
    const currentLower = input.currentText.toLowerCase();

    const missingCoreSections = sections.filter((s) => !currentLower.includes(s));
    const coveredSections = sections.filter((s) => currentLower.includes(s)).slice(0, 4);

    const baseScore = Math.min(
      92,
      45 + Math.round(input.currentText.length / 1200) + coveredSections.length * 5,
    );
    const progressScore = Math.max(35, baseScore);
    const trendDelta = input.previousProgress ? progressScore - input.previousProgress : 0;
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

  /**
   * 3-layer citation validation:
   *   Layer 1 — regex extraction (always runs)
   *   Layer 2 — GPT format check (if Azure OpenAI available)
   *   Layer 3 — Semantic Scholar existence check (if configured)
   */
  private async buildCitationReport(
    text: string,
  ): Promise<Omit<CitationReport, 'id' | 'submissionId' | 'createdAt'>> {
    // Layer 1: Regex detection
    const authorYearMatches =
      text.match(/\([A-Z][A-Za-z]+(?:,\s*[A-Z][A-Za-z]+)?,\s*\d{4}(?:,\s*p\.?\s*\d+)?\)/g) ?? [];
    const numericMatches = text.match(/\[\d+(?:[-–]\d+)?\]/g) ?? [];
    const referenceLines = this.extractReferenceLines(text);

    const citationCount = authorYearMatches.length + numericMatches.length;
    const hasReferenceSection = /references|bibliography/i.test(text);

    const missingCitations: string[] =
      citationCount === 0 ? ['No in-text citations detected.'] : [];
    const brokenReferences: string[] = hasReferenceSection
      ? []
      : ['Reference section not detected.'];

    // Layer 2: GPT format validation
    let formattingErrors: string[] = [];
    if (referenceLines.length > 0 && this.azureOpenAi.isAvailable()) {
      const result = await this.azureOpenAi.validateCitationFormats(referenceLines);
      formattingErrors = result.formatting_errors;
    } else if (!/et al\./i.test(text)) {
      formattingErrors = ['Could not confidently detect standard citation formatting cues.'];
    }

    // Layer 3: Semantic Scholar existence check (on a sample of reference lines)
    const toVerify = referenceLines.slice(0, 10);
    if (toVerify.length > 0) {
      try {
        const { unverified } = await this.semanticScholar.checkCitationsExist(toVerify);
        if (unverified.length > 0) {
          const summary = `${unverified.length} citation(s) could not be verified in Semantic Scholar.`;
          missingCitations.push(summary);
        }
      } catch (err) {
        this.logger.warn('Semantic Scholar check failed, skipping Layer 3', err);
      }
    }

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

  /**
   * Extract individual reference/bibliography lines for citation validation.
   */
  private extractReferenceLines(text: string): string[] {
    const refSectionMatch = /(?:references|bibliography)\s*\n([\s\S]{0,8000})/i.exec(text);
    if (!refSectionMatch) return [];

    return refSectionMatch[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 20)
      .slice(0, 50);
  }

  /**
   * Start Copyleaks scan (async) or fall back to heuristic.
   * Returns an initial report: '__pending__' sentinel in flaggedSections if async scan started.
   */
  private async buildPlagiarismReport(
    text: string,
    submissionId: string,
    webhookBase: string,
  ): Promise<Omit<PlagiarismReport, 'id' | 'submissionId' | 'createdAt'>> {
    if (this.copyleaks.isAvailable()) {
      const scanResult = await this.copyleaks.startScan({
        text,
        submissionId,
        webhookBaseUrl: webhookBase,
      });

      if (scanResult) {
        // Return pending placeholder — webhook will update this record
        return {
          similarityPercent: 0,
          riskLevel: 'green',
          flaggedSections: ['__pending__'],
        };
      }
    }

    // Heuristic fallback
    return this.buildPlagiarismHeuristic(text);
  }

  private buildPlagiarismHeuristic(
    text: string,
  ): Omit<PlagiarismReport, 'id' | 'submissionId' | 'createdAt'> {
    const sentences = text
      .split(/[.!?]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 24);

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
  ): { additions: number; deletions: number; majorEdits: number } {
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
      .map((l) => l.trim())
      .filter(Boolean);
    const currentLines = currentText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const previousSet = new Set(previousLines);
    const currentSet = new Set(currentLines);

    const additions = currentLines.filter((l) => !previousSet.has(l)).length;
    const deletions = previousLines.filter((l) => !currentSet.has(l)).length;
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
        .filter((t) => t.length > 4),
    );

    if (abstractTokens.size === 0) return 'insufficient_data';

    let matched = 0;
    for (const token of abstractTokens) {
      if (text.toLowerCase().includes(token)) {
        matched += 1;
      }
    }

    const ratio = matched / abstractTokens.size;
    if (ratio >= 0.55) return 'on_track';
    if (ratio >= 0.3) return 'partially_aligned';
    return 'needs_realignment';
  }
}
