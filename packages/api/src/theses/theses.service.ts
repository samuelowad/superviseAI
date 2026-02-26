import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createRequire } from 'module';
import { Repository } from 'typeorm';

import { CitationReport } from '../analysis/entities/citation-report.entity';
import { PlagiarismReport } from '../analysis/entities/plagiarism-report.entity';
import { ThesisAnalysis } from '../analysis/entities/thesis-analysis.entity';
import { CoachingSession } from '../coaching/entities/coaching-session.entity';
import { StorageService } from '../storage/storage.service';
import { Submission, SubmissionStatus } from '../submissions/entities/submission.entity';
import { User, UserRole } from '../users/user.entity';
import { CreateThesisDto } from './dto/create-thesis.dto';
import { Thesis, ThesisStatus } from './entities/thesis.entity';

const runtimeRequire = createRequire(__filename);

@Injectable()
export class ThesesService {
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
    @InjectRepository(CoachingSession)
    private readonly coachingSessionRepository: Repository<CoachingSession>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly storageService: StorageService,
  ) {}

  async create(studentId: string, dto: CreateThesisDto): Promise<{ thesis: Thesis }> {
    const existing = await this.thesisRepository.findOne({ where: { studentId } });
    if (existing) {
      throw new BadRequestException('A thesis already exists for this student.');
    }

    const abstract = dto.abstract.trim();
    if (abstract.length < 40) {
      throw new BadRequestException('Abstract must be at least 40 characters.');
    }

    const supervisor = await this.resolveSupervisor(dto.supervisor_id, dto.supervisor_query);

    const thesis = this.thesisRepository.create({
      studentId,
      title: dto.title.trim(),
      abstract,
      supervisorId: supervisor?.id ?? null,
      supervisorName: supervisor?.fullName ?? null,
      status: ThesisStatus.DRAFT,
      latestProfessorFeedback: null,
      latestFeedbackAt: null,
    });

    return { thesis: await this.thesisRepository.save(thesis) };
  }

  async searchProfessors(query: string): Promise<{ professors: Array<Record<string, string>> }> {
    const normalized = query.trim();
    if (normalized.length < 2) {
      return { professors: [] };
    }

    const professors = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.email', 'user.fullName'])
      .where('user.role = :role', { role: UserRole.PROFESSOR })
      .andWhere('user.isActive = true')
      .andWhere('user.isVerified = true')
      .andWhere('(user.email ILIKE :query OR user.fullName ILIKE :query)', {
        query: `%${normalized}%`,
      })
      .orderBy('user.fullName', 'ASC')
      .limit(8)
      .getMany();

    return {
      professors: professors.map((professor) => ({
        id: professor.id,
        email: professor.email,
        full_name: professor.fullName,
      })),
    };
  }

  async findByStudentId(studentId: string): Promise<Thesis | null> {
    return this.thesisRepository.findOne({ where: { studentId } });
  }

  async findOwnedThesis(studentId: string, thesisId: string): Promise<Thesis> {
    const thesis = await this.thesisRepository.findOne({ where: { id: thesisId, studentId } });
    if (!thesis) {
      throw new NotFoundException('Thesis not found for this student.');
    }

    return thesis;
  }

  async setStatus(thesisId: string, status: ThesisStatus): Promise<void> {
    await this.thesisRepository.update({ id: thesisId }, { status });
  }

  async sendToSupervisor(studentId: string, thesisId: string): Promise<{ status: ThesisStatus }> {
    const thesis = await this.findOwnedThesis(studentId, thesisId);

    const latestCompleteSubmission = await this.submissionRepository.findOne({
      where: {
        thesisId: thesis.id,
        status: SubmissionStatus.COMPLETE,
      },
      order: { versionNumber: 'DESC' },
    });

    if (!latestCompleteSubmission) {
      throw new BadRequestException('Upload at least one completed submission before sending.');
    }

    thesis.status = ThesisStatus.SUBMITTED_TO_PROF;
    await this.thesisRepository.save(thesis);

    return { status: thesis.status };
  }

  async getWorkspace(studentId: string): Promise<Record<string, unknown>> {
    const thesis = await this.findByStudentId(studentId);
    if (!thesis) {
      return { thesis: null };
    }

    const submissions = await this.submissionRepository.find({
      where: { thesisId: thesis.id },
      order: { versionNumber: 'DESC' },
    });

    const activeSubmission = submissions[0] ?? null;
    const previousSubmission = submissions[1] ?? null;

    let analysis: ThesisAnalysis | null = null;
    let citation: CitationReport | null = null;
    let plagiarism: PlagiarismReport | null = null;

    if (activeSubmission) {
      [analysis, citation, plagiarism] = await Promise.all([
        this.thesisAnalysisRepository.findOne({ where: { submissionId: activeSubmission.id } }),
        this.citationReportRepository.findOne({ where: { submissionId: activeSubmission.id } }),
        this.plagiarismReportRepository.findOne({ where: { submissionId: activeSubmission.id } }),
      ]);
    }

    const latestSession = await this.coachingSessionRepository.findOne({
      where: { thesisId: thesis.id },
      order: { createdAt: 'DESC' },
    });

    const milestoneDueDate = new Date();
    milestoneDueDate.setDate(milestoneDueDate.getDate() + 10);

    const dueInDays = Math.max(
      0,
      Math.ceil((milestoneDueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );

    const statusLabel = this.getStatusLabel(thesis.status);
    const supervisorStatus = thesis.supervisorName
      ? thesis.status === ThesisStatus.SUBMITTED_TO_PROF
        ? 'Awaiting Review'
        : 'Assigned'
      : 'Unassigned';

    const showVersionComparison = Boolean(
      activeSubmission && previousSubmission && analysis && !analysis.isFirstSubmission,
    );
    const pdfView = await this.buildPdfView(activeSubmission, previousSubmission, analysis);
    const prDiff = this.buildPullRequestDiff(
      previousSubmission?.extractedText ?? '',
      activeSubmission?.extractedText ?? '',
    );

    const centralPanel = !showVersionComparison
      ? {
          mode: 'first_submission',
          abstract_alignment: {
            verdict: analysis?.abstractAlignmentVerdict ?? 'insufficient_data',
            key_topic_coverage: analysis?.keyTopicCoverage ?? [],
            missing_core_sections: analysis?.missingCoreSections ?? [],
            structural_readiness: analysis?.structuralReadiness ?? 'developing',
          },
        }
      : {
          mode: 'version_comparison',
          version_comparison: {
            additions: analysis?.additionsCount ?? 0,
            deletions: analysis?.deletionsCount ?? 0,
            major_edits: analysis?.majorEditsCount ?? 0,
            gaps_resolved: analysis?.gapsResolved ?? 0,
            gaps_open: analysis?.gapsOpen ?? 0,
            previous_excerpt: analysis?.previousExcerpt ?? '',
            current_excerpt: analysis?.currentExcerpt ?? '',
            pr_diff: prDiff,
            pdf_view: pdfView,
          },
        };

    return {
      thesis: {
        id: thesis.id,
        title: thesis.title,
        abstract: thesis.abstract,
        status: thesis.status,
        status_label: statusLabel,
        supervisor_name: thesis.supervisorName,
        supervisor_status: supervisorStatus,
      },
      active_submission: activeSubmission
        ? {
            id: activeSubmission.id,
            version_number: activeSubmission.versionNumber,
            status: activeSubmission.status,
            created_at: activeSubmission.createdAt,
          }
        : null,
      metrics: {
        progress_score: analysis?.progressScore ?? 0,
        trend_delta: analysis?.trendDelta ?? 0,
        citation_health_score: citation?.citationHealthScore ?? 0,
        citation_issues: citation?.issuesCount ?? 0,
        plagiarism_similarity: plagiarism?.similarityPercent ?? 0,
        next_milestone: 'Draft Review',
        due_in_days: dueInDays,
      },
      central_panel: centralPanel,
      right_panel: {
        plagiarism: {
          similarity_percent: plagiarism?.similarityPercent ?? 0,
          risk_level: plagiarism?.riskLevel ?? 'green',
          flagged_sections: plagiarism?.flaggedSections ?? [],
        },
        citations: {
          missing_citations: citation?.missingCitations ?? [],
          broken_references: citation?.brokenReferences ?? [],
          formatting_errors: citation?.formattingErrors ?? [],
        },
        milestone: {
          next_milestone: 'Draft Review',
          due_in_days: dueInDays,
          status: thesis.status,
        },
        latest_professor_feedback: {
          text: thesis.latestProfessorFeedback ?? 'No professor feedback yet.',
          timestamp: thesis.latestFeedbackAt?.toISOString() ?? null,
        },
      },
      coaching_summary: latestSession
        ? {
            readiness_score: latestSession.readinessScore,
            weak_topics: latestSession.weakTopics,
            updated_at: latestSession.updatedAt,
          }
        : null,
      submissions: submissions.map((submission) => ({
        id: submission.id,
        version_number: submission.versionNumber,
        status: submission.status,
        created_at: submission.createdAt,
      })),
    };
  }

  private getStatusLabel(status: ThesisStatus): string {
    const labels: Record<ThesisStatus, string> = {
      [ThesisStatus.DRAFT]: 'Draft',
      [ThesisStatus.SUPERVISED]: 'Supervised',
      [ThesisStatus.SUBMITTED_TO_PROF]: 'Awaiting Review',
      [ThesisStatus.RETURNED_TO_STUDENT]: 'Returned',
      [ThesisStatus.COMPLETED]: 'Completed',
    };

    return labels[status];
  }

  private async resolveSupervisor(
    supervisorId?: string,
    supervisorQuery?: string,
  ): Promise<Pick<User, 'id' | 'fullName' | 'role' | 'isActive' | 'isVerified'> | null> {
    if (supervisorId) {
      const supervisorById = await this.userRepository.findOne({ where: { id: supervisorId } });
      if (!supervisorById) {
        throw new BadRequestException('Selected supervisor was not found.');
      }

      this.ensureSupervisorEligibility(supervisorById);
      return supervisorById;
    }

    const normalized = supervisorQuery?.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const supervisorByQuery = await this.userRepository
      .createQueryBuilder('user')
      .where('user.role = :role', { role: UserRole.PROFESSOR })
      .andWhere('user.isActive = true')
      .andWhere('user.isVerified = true')
      .andWhere('(LOWER(user.email) = :query OR LOWER(user.fullName) = :query)', {
        query: normalized,
      })
      .getOne();

    if (!supervisorByQuery) {
      throw new BadRequestException('Use a verified professor email/name or pick one from search.');
    }

    return supervisorByQuery;
  }

  private ensureSupervisorEligibility(
    supervisor: Pick<User, 'role' | 'isActive' | 'isVerified'>,
  ): void {
    if (supervisor.role !== UserRole.PROFESSOR || !supervisor.isActive || !supervisor.isVerified) {
      throw new BadRequestException('Supervisor must be an active and verified professor.');
    }
  }

  private async buildPdfView(
    activeSubmission: Submission | null,
    previousSubmission: Submission | null,
    analysis: ThesisAnalysis | null,
  ): Promise<{
    previous_pdf_url: string | null;
    current_pdf_url: string | null;
    changes: Array<{
      id: string;
      label: string;
      type: 'addition' | 'removal' | 'edit';
      preview: string;
    }>;
  }> {
    const changes = this.buildChangeMarkers(
      analysis?.previousExcerpt ?? '',
      analysis?.currentExcerpt ?? '',
    );
    if (!activeSubmission || !previousSubmission) {
      return { previous_pdf_url: null, current_pdf_url: null, changes };
    }

    const previousIsPdf = previousSubmission.fileKey.toLowerCase().endsWith('.pdf');
    const currentIsPdf = activeSubmission.fileKey.toLowerCase().endsWith('.pdf');
    if (!previousIsPdf || !currentIsPdf) {
      return { previous_pdf_url: null, current_pdf_url: null, changes };
    }

    try {
      const [previousPdfUrl, currentPdfUrl] = await Promise.all([
        this.storageService.getSignedUrl(previousSubmission.fileKey),
        this.storageService.getSignedUrl(activeSubmission.fileKey),
      ]);

      return {
        previous_pdf_url: previousPdfUrl,
        current_pdf_url: currentPdfUrl,
        changes,
      };
    } catch {
      return { previous_pdf_url: null, current_pdf_url: null, changes };
    }
  }

  private buildChangeMarkers(
    previousExcerpt: string,
    currentExcerpt: string,
  ): Array<{ id: string; label: string; type: 'addition' | 'removal' | 'edit'; preview: string }> {
    if (
      this.isNonSemanticBinaryExtraction(previousExcerpt) ||
      this.isNonSemanticBinaryExtraction(currentExcerpt)
    ) {
      return [
        {
          id: 'change-note-1',
          label: 'Diff Notice',
          type: 'edit',
          preview:
            'Binary PDF stream detected instead of semantic text. Re-upload after parser setup to get meaningful diff.',
        },
      ];
    }

    const prevChunks = previousExcerpt
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const currChunks = currentExcerpt
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const prevSet = new Set(prevChunks);
    const currSet = new Set(currChunks);

    const additions = currChunks
      .filter((line) => !prevSet.has(line))
      .slice(0, 6)
      .map((line, index) => ({
        id: `change-add-${index + 1}`,
        label: `Addition ${index + 1}`,
        type: 'addition' as const,
        preview: line.slice(0, 220),
      }));

    const removals = prevChunks
      .filter((line) => !currSet.has(line))
      .slice(0, 4)
      .map((line, index) => ({
        id: `change-rem-${index + 1}`,
        label: `Removal ${index + 1}`,
        type: 'removal' as const,
        preview: line.slice(0, 220),
      }));

    const edits = currChunks
      .filter((line) => prevChunks.some((prev) => this.isLikelyEdit(prev, line)))
      .slice(0, 4)
      .map((line, index) => ({
        id: `change-edit-${index + 1}`,
        label: `Edit ${index + 1}`,
        type: 'edit' as const,
        preview: line.slice(0, 220),
      }));

    return [...additions, ...removals, ...edits].slice(0, 10);
  }

  private isLikelyEdit(previousLine: string, currentLine: string): boolean {
    if (previousLine === currentLine) {
      return false;
    }

    const prevTokens = previousLine.toLowerCase().split(/\s+/).filter(Boolean);
    const currTokens = currentLine.toLowerCase().split(/\s+/).filter(Boolean);
    if (prevTokens.length < 5 || currTokens.length < 5) {
      return false;
    }

    const prevSet = new Set(prevTokens);
    const overlap = currTokens.filter((token) => prevSet.has(token)).length;
    return overlap / Math.max(prevTokens.length, currTokens.length) >= 0.55;
  }

  private buildPullRequestDiff(
    previousText: string,
    currentText: string,
  ): {
    capability: 'ready' | 'parser_missing' | 'binary_detected' | 'no_content';
    message: string | null;
    rows: Array<{
      type: 'context' | 'addition' | 'removal';
      left_line: number | null;
      right_line: number | null;
      left_text: string;
      right_text: string;
    }>;
    stats: {
      additions: number;
      removals: number;
      unchanged: number;
      truncated: boolean;
    };
  } {
    const parserMissingInText =
      previousText.includes('text extraction is unavailable in this environment') ||
      currentText.includes('text extraction is unavailable in this environment');
    const parserDependencyPresent =
      this.hasRuntimeDependency('pdf-parse') || this.hasRuntimeDependency('mammoth');

    if (parserMissingInText || !parserDependencyPresent) {
      return {
        capability: 'parser_missing',
        message:
          'Semantic diff is unavailable because parser dependencies are missing. Install pdf-parse/mammoth, then upload a new version.',
        rows: [
          {
            type: 'context',
            left_line: 1,
            right_line: 1,
            left_text: 'Parser-backed extraction unavailable for previous submission.',
            right_text: 'Parser-backed extraction unavailable for current submission.',
          },
        ],
        stats: {
          additions: 0,
          removals: 0,
          unchanged: 1,
          truncated: false,
        },
      };
    }

    if (
      this.isNonSemanticBinaryExtraction(previousText) ||
      this.isNonSemanticBinaryExtraction(currentText)
    ) {
      return {
        capability: 'binary_detected',
        message:
          'Binary PDF stream detected instead of semantic text. Re-upload after parser setup to get meaningful diff.',
        rows: [
          {
            type: 'context',
            left_line: 1,
            right_line: 1,
            left_text:
              'Binary PDF content detected in previous submission. Semantic diff unavailable until parser-backed extraction is enabled.',
            right_text:
              'Binary PDF content detected in current submission. Semantic diff unavailable until parser-backed extraction is enabled.',
          },
        ],
        stats: {
          additions: 0,
          removals: 0,
          unchanged: 1,
          truncated: false,
        },
      };
    }

    const { lines: previousLines, truncated: previousTruncated } = this.normalizeDiffLines(
      previousText,
      280,
    );
    const { lines: currentLines, truncated: currentTruncated } = this.normalizeDiffLines(
      currentText,
      280,
    );

    if (previousLines.length === 0 && currentLines.length === 0) {
      return {
        capability: 'no_content',
        message: 'No extractable text found in either version for diffing.',
        rows: [],
        stats: {
          additions: 0,
          removals: 0,
          unchanged: 0,
          truncated: false,
        },
      };
    }

    const truncated = previousTruncated || currentTruncated;

    const operations = this.diffLines(previousLines, currentLines);

    let leftLine = 1;
    let rightLine = 1;
    let additions = 0;
    let removals = 0;
    let unchanged = 0;

    const rows = operations.map((operation) => {
      if (operation.type === 'context') {
        const row = {
          type: 'context' as const,
          left_line: leftLine,
          right_line: rightLine,
          left_text: operation.leftText,
          right_text: operation.rightText,
        };
        leftLine += 1;
        rightLine += 1;
        unchanged += 1;
        return row;
      }

      if (operation.type === 'removal') {
        const row = {
          type: 'removal' as const,
          left_line: leftLine,
          right_line: null,
          left_text: operation.leftText,
          right_text: '',
        };
        leftLine += 1;
        removals += 1;
        return row;
      }

      const row = {
        type: 'addition' as const,
        left_line: null,
        right_line: rightLine,
        left_text: '',
        right_text: operation.rightText,
      };
      rightLine += 1;
      additions += 1;
      return row;
    });

    return {
      capability: 'ready',
      message: null,
      rows,
      stats: {
        additions,
        removals,
        unchanged,
        truncated,
      },
    };
  }

  private normalizeDiffLines(
    text: string,
    maxLines: number,
  ): {
    lines: string[];
    truncated: boolean;
  } {
    const cleaned = text.replace(/\r\n/g, '\n').trim();
    if (!cleaned) {
      return { lines: [], truncated: false };
    }

    const lines = cleaned.includes('\n')
      ? cleaned.split('\n')
      : cleaned
          .split(/(?<=[.!?])\s+/)
          .map((line) => line.trim())
          .filter(Boolean);

    const normalized = lines.map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (normalized.length <= maxLines) {
      return { lines: normalized, truncated: false };
    }

    return {
      lines: normalized.slice(0, maxLines),
      truncated: true,
    };
  }

  private diffLines(
    previousLines: string[],
    currentLines: string[],
  ): Array<
    | { type: 'context'; leftText: string; rightText: string }
    | { type: 'addition'; rightText: string }
    | { type: 'removal'; leftText: string }
  > {
    const rows = previousLines.length;
    const cols = currentLines.length;
    const lcs = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let col = cols - 1; col >= 0; col -= 1) {
        if (previousLines[row] === currentLines[col]) {
          lcs[row][col] = lcs[row + 1][col + 1] + 1;
        } else {
          lcs[row][col] = Math.max(lcs[row + 1][col], lcs[row][col + 1]);
        }
      }
    }

    const operations: Array<
      | { type: 'context'; leftText: string; rightText: string }
      | { type: 'addition'; rightText: string }
      | { type: 'removal'; leftText: string }
    > = [];

    let row = 0;
    let col = 0;

    while (row < rows && col < cols) {
      if (previousLines[row] === currentLines[col]) {
        operations.push({
          type: 'context',
          leftText: previousLines[row],
          rightText: currentLines[col],
        });
        row += 1;
        col += 1;
      } else if (lcs[row + 1][col] >= lcs[row][col + 1]) {
        operations.push({
          type: 'removal',
          leftText: previousLines[row],
        });
        row += 1;
      } else {
        operations.push({
          type: 'addition',
          rightText: currentLines[col],
        });
        col += 1;
      }
    }

    while (row < rows) {
      operations.push({
        type: 'removal',
        leftText: previousLines[row],
      });
      row += 1;
    }

    while (col < cols) {
      operations.push({
        type: 'addition',
        rightText: currentLines[col],
      });
      col += 1;
    }

    return operations;
  }

  private isNonSemanticBinaryExtraction(text: string): boolean {
    const sample = text.slice(0, 3000);
    if (!sample) {
      return false;
    }

    if (sample.includes('text extraction is unavailable in this environment')) {
      return true;
    }

    const hasPdfMarkers =
      /%PDF-\d\.\d/.test(sample) || /\/FlateDecode|endobj|stream x|\/Type\s*\/Page/.test(sample);
    if (!hasPdfMarkers) {
      return false;
    }

    let nonPrintable = 0;
    for (let index = 0; index < sample.length; index += 1) {
      const code = sample.charCodeAt(index);
      const isPrintableAscii =
        code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
      if (!isPrintableAscii) {
        nonPrintable += 1;
      }
    }

    return nonPrintable / sample.length > 0.08 || sample.length > 1200;
  }

  private hasRuntimeDependency(moduleName: string): boolean {
    try {
      runtimeRequire.resolve(moduleName);
      return true;
    } catch {
      return false;
    }
  }
}
