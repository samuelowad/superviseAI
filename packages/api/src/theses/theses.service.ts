import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createRequire } from 'module';
import { In, Repository } from 'typeorm';

import { CitationReport } from '../analysis/entities/citation-report.entity';
import { PlagiarismReport } from '../analysis/entities/plagiarism-report.entity';
import { ThesisAnalysis } from '../analysis/entities/thesis-analysis.entity';
import { CoachingSession } from '../coaching/entities/coaching-session.entity';
import { CohortsService } from '../cohorts/cohorts.service';
import { AzureOpenAiService } from '../integrations/azure/azure-openai.service';
import { Milestone } from '../milestones/entities/milestone.entity';
import { Submission, SubmissionStatus } from '../submissions/entities/submission.entity';
import { User, UserRole } from '../users/user.entity';
import { CreateThesisDto } from './dto/create-thesis.dto';
import { Thesis, ThesisStatus } from './entities/thesis.entity';

const runtimeRequire = createRequire(__filename);

type ReviewAction =
  | 'save_feedback'
  | 'return_to_student'
  | 'request_revisions'
  | 'approve_milestone'
  | 'mark_complete';

interface RiskAssessment {
  level: 'green' | 'yellow' | 'red';
  reasons: string[];
}

interface ProfessorStudentSnapshot {
  thesis: Thesis;
  student: User | null;
  latestSubmission: Submission | null;
  latestAnalysis: ThesisAnalysis | null;
  latestPlagiarism: PlagiarismReport | null;
  risk: RiskAssessment;
}

interface ProfessorAiReviewSummary {
  status_note: string;
  change_summary: string;
  recommended_feedback: string[];
  stage_context: string | null;
}

interface UploadedProposalFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

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
    @InjectRepository(Milestone)
    private readonly milestoneRepository: Repository<Milestone>,
    private readonly cohortsService: CohortsService,
    private readonly azureOpenAi: AzureOpenAiService,
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

    const savedThesis = await this.thesisRepository.save(thesis);
    if (savedThesis.supervisorId) {
      await this.cohortsService.ensureEnrollmentInProfessorDefaultCohort(
        savedThesis.supervisorId,
        savedThesis.studentId,
      );
    }

    return { thesis: savedThesis };
  }

  async parseAbstractFile(
    file: UploadedProposalFile,
  ): Promise<{ text: string; file_name: string; truncated: boolean; original_length: number }> {
    this.validateAbstractFile(file);

    const extracted = await this.extractAbstractText(file);
    const normalized = extracted.replace(/\s+/g, ' ').trim();

    if (normalized.length < 40) {
      throw new BadRequestException(
        'Uploaded file did not contain enough readable text for an abstract (minimum 40 characters).',
      );
    }

    const max = 30000;
    const truncated = normalized.length > max;
    const text = truncated ? normalized.slice(0, max) : normalized;

    return {
      text,
      file_name: file.originalname,
      truncated,
      original_length: normalized.length,
    };
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
    if (thesis.supervisorId) {
      await this.cohortsService.ensureEnrollmentInProfessorDefaultCohort(
        thesis.supervisorId,
        thesis.studentId,
      );
    }
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
    const activeMilestone = await this.resolveActiveMilestoneForThesis(thesis);
    const dueInDays = activeMilestone?.dueInDays ?? null;
    const milestoneTitle = activeMilestone?.title ?? 'No milestone set';
    const milestoneDueDate = activeMilestone?.dueDate ?? null;
    const milestoneId = activeMilestone?.id ?? null;
    const milestoneStatus = this.getMilestoneStatusLabel(thesis.status);

    const statusLabel = this.getStatusLabel(thesis.status);
    const supervisorStatus = thesis.supervisorName
      ? thesis.status === ThesisStatus.SUBMITTED_TO_PROF
        ? 'Awaiting Review'
        : 'Assigned'
      : 'Unassigned';

    const showVersionComparison = Boolean(
      activeSubmission && previousSubmission && analysis && !analysis.isFirstSubmission,
    );
    const pdfView = this.buildPdfViewPaths(activeSubmission, previousSubmission, analysis);
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
        next_milestone: milestoneTitle,
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
          id: milestoneId,
          next_milestone: milestoneTitle,
          due_date: milestoneDueDate,
          due_in_days: dueInDays,
          status: milestoneStatus,
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

  async getProfessorDashboard(professorId: string): Promise<Record<string, unknown>> {
    const snapshots = await this.buildProfessorSnapshots(professorId);

    const students = snapshots
      .map((snapshot) => ({
        thesis_id: snapshot.thesis.id,
        thesis_title: snapshot.thesis.title,
        thesis_status: snapshot.thesis.status,
        thesis_status_label: this.getStatusLabel(snapshot.thesis.status),
        student_id: snapshot.student?.id ?? snapshot.thesis.studentId,
        student_name: snapshot.student?.fullName ?? 'Unknown Student',
        student_email: snapshot.student?.email ?? null,
        progress_score: snapshot.latestAnalysis?.progressScore ?? 0,
        trend_delta: snapshot.latestAnalysis?.trendDelta ?? 0,
        abstract_alignment_verdict:
          snapshot.latestAnalysis?.abstractAlignmentVerdict ?? 'insufficient_data',
        plagiarism_similarity: snapshot.latestPlagiarism?.similarityPercent ?? 0,
        last_submission_at: snapshot.latestSubmission?.createdAt?.toISOString() ?? null,
        ai_status_note: this.buildProfessorStatusNote(snapshot),
        risk_level: snapshot.risk.level,
        risk_reasons: snapshot.risk.reasons,
      }))
      .sort((left, right) => {
        const rank: Record<'red' | 'yellow' | 'green', number> = {
          red: 0,
          yellow: 1,
          green: 2,
        };
        const levelOrder = rank[left.risk_level] - rank[right.risk_level];
        if (levelOrder !== 0) {
          return levelOrder;
        }

        const leftTimestamp = left.last_submission_at
          ? new Date(left.last_submission_at).getTime()
          : 0;
        const rightTimestamp = right.last_submission_at
          ? new Date(right.last_submission_at).getTime()
          : 0;
        return rightTimestamp - leftTimestamp;
      });

    const summary = {
      total_students: snapshots.length,
      active_theses: snapshots.filter(
        (snapshot) => snapshot.thesis.status !== ThesisStatus.COMPLETED,
      ).length,
      awaiting_review: snapshots.filter(
        (snapshot) => snapshot.thesis.status === ThesisStatus.SUBMITTED_TO_PROF,
      ).length,
      at_risk_count: snapshots.filter((snapshot) => snapshot.risk.level !== 'green').length,
    };

    return { summary, students };
  }

  async getProfessorStudents(
    professorId: string,
  ): Promise<{ students: Array<Record<string, unknown>> }> {
    const dashboard = await this.getProfessorDashboard(professorId);
    const students =
      typeof dashboard === 'object' && dashboard !== null && 'students' in dashboard
        ? ((dashboard as { students?: Array<Record<string, unknown>> }).students ?? [])
        : [];
    return { students };
  }

  async getProfessorStudentDetail(
    professorId: string,
    thesisId: string,
  ): Promise<Record<string, unknown>> {
    const thesis = await this.findProfessorScopedThesisById(professorId, thesisId);

    const student = await this.userRepository.findOne({
      where: { id: thesis.studentId },
    });

    const submissions = await this.submissionRepository.find({
      where: { thesisId: thesis.id },
      order: { versionNumber: 'DESC' },
    });
    const activeSubmission = submissions[0] ?? null;
    const previousSubmission = submissions[1] ?? null;

    const submissionIds = submissions.map((submission) => submission.id);
    const [analysisRows, citationRows, plagiarismRows, latestSession] = await Promise.all([
      submissionIds.length
        ? this.thesisAnalysisRepository.find({ where: { submissionId: In(submissionIds) } })
        : Promise.resolve([]),
      submissionIds.length
        ? this.citationReportRepository.find({ where: { submissionId: In(submissionIds) } })
        : Promise.resolve([]),
      submissionIds.length
        ? this.plagiarismReportRepository.find({ where: { submissionId: In(submissionIds) } })
        : Promise.resolve([]),
      this.coachingSessionRepository.findOne({
        where: { thesisId: thesis.id },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const activeMilestone = await this.resolveActiveMilestoneForThesis(thesis);

    const analysisBySubmission = new Map(
      analysisRows.map((analysis) => [analysis.submissionId, analysis]),
    );
    const citationBySubmission = new Map(
      citationRows.map((citation) => [citation.submissionId, citation]),
    );
    const plagiarismBySubmission = new Map(
      plagiarismRows.map((plagiarism) => [plagiarism.submissionId, plagiarism]),
    );

    const activeAnalysis = activeSubmission
      ? (analysisBySubmission.get(activeSubmission.id) ?? null)
      : null;
    const activeCitation = activeSubmission
      ? (citationBySubmission.get(activeSubmission.id) ?? null)
      : null;
    const activePlagiarism = activeSubmission
      ? (plagiarismBySubmission.get(activeSubmission.id) ?? null)
      : null;

    const progressHistory = [...submissions]
      .sort((left, right) => left.versionNumber - right.versionNumber)
      .map((submission) => {
        const analysis = analysisBySubmission.get(submission.id);
        if (!analysis) {
          return null;
        }

        return {
          version_number: submission.versionNumber,
          progress_score: analysis.progressScore,
          trend_delta: analysis.trendDelta,
          created_at: submission.createdAt.toISOString(),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const plagiarismHistory = [...submissions]
      .sort((left, right) => left.versionNumber - right.versionNumber)
      .map((submission) => {
        const plagiarism = plagiarismBySubmission.get(submission.id);
        if (!plagiarism) {
          return null;
        }

        return {
          version_number: submission.versionNumber,
          similarity_percent: plagiarism.similarityPercent,
          risk_level: plagiarism.riskLevel,
          created_at: submission.createdAt.toISOString(),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const timeline: Array<{
      id: string;
      label: string;
      timestamp: string;
      type: 'status' | 'submission' | 'feedback';
    }> = [
      {
        id: 'thesis-created',
        label: 'Thesis created',
        timestamp: thesis.createdAt.toISOString(),
        type: 'status',
      },
      ...[...submissions]
        .sort((left, right) => left.versionNumber - right.versionNumber)
        .map((submission) => ({
          id: `submission-${submission.id}`,
          label: `Version ${submission.versionNumber} uploaded`,
          timestamp: submission.createdAt.toISOString(),
          type: 'submission' as const,
        })),
    ];

    if (thesis.status === ThesisStatus.SUBMITTED_TO_PROF) {
      timeline.push({
        id: 'status-awaiting-review',
        label: 'Sent to supervisor',
        timestamp: thesis.updatedAt.toISOString(),
        type: 'status',
      });
    }

    if (thesis.latestFeedbackAt) {
      timeline.push({
        id: 'prof-feedback',
        label: 'Professor feedback updated',
        timestamp: thesis.latestFeedbackAt.toISOString(),
        type: 'feedback',
      });
    }

    if (thesis.status === ThesisStatus.COMPLETED) {
      timeline.push({
        id: 'status-complete',
        label: 'Thesis marked complete',
        timestamp: thesis.updatedAt.toISOString(),
        type: 'status',
      });
    }

    timeline.sort(
      (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
    );

    const comparison =
      activeSubmission && previousSubmission
        ? {
            previous_version: previousSubmission.versionNumber,
            current_version: activeSubmission.versionNumber,
            additions: activeAnalysis?.additionsCount ?? 0,
            deletions: activeAnalysis?.deletionsCount ?? 0,
            major_edits: activeAnalysis?.majorEditsCount ?? 0,
            pr_diff: this.buildPullRequestDiff(
              previousSubmission.extractedText ?? '',
              activeSubmission.extractedText ?? '',
            ),
            pdf_view: this.buildPdfViewPaths(activeSubmission, previousSubmission, activeAnalysis),
          }
        : null;

    const aiReview = await this.buildProfessorAiReview({
      thesis,
      activeSubmission,
      previousSubmission,
      activeAnalysis,
      activeCitation,
      activePlagiarism,
      activeMilestoneStage: activeMilestone?.stage ?? null,
      comparison,
    });

    return {
      student: {
        id: student?.id ?? thesis.studentId,
        full_name: student?.fullName ?? 'Unknown Student',
        email: student?.email ?? null,
      },
      thesis: {
        id: thesis.id,
        title: thesis.title,
        abstract: thesis.abstract,
        status: thesis.status,
        status_label: this.getStatusLabel(thesis.status),
        latest_professor_feedback: thesis.latestProfessorFeedback,
        latest_feedback_at: thesis.latestFeedbackAt?.toISOString() ?? null,
      },
      latest_submission: activeSubmission
        ? {
            id: activeSubmission.id,
            version_number: activeSubmission.versionNumber,
            status: activeSubmission.status,
            created_at: activeSubmission.createdAt.toISOString(),
          }
        : null,
      metrics: {
        progress_score: activeAnalysis?.progressScore ?? 0,
        trend_delta: activeAnalysis?.trendDelta ?? 0,
        citation_health_score: activeCitation?.citationHealthScore ?? 0,
        plagiarism_similarity: activePlagiarism?.similarityPercent ?? 0,
        readiness_score: latestSession?.readinessScore ?? null,
      },
      abstract_alignment: {
        verdict: activeAnalysis?.abstractAlignmentVerdict ?? 'insufficient_data',
        key_topic_coverage: activeAnalysis?.keyTopicCoverage ?? [],
        missing_core_sections: activeAnalysis?.missingCoreSections ?? [],
        structural_readiness: activeAnalysis?.structuralReadiness ?? 'developing',
      },
      reports: {
        citations: {
          issues_count: activeCitation?.issuesCount ?? 0,
          missing_citations: activeCitation?.missingCitations ?? [],
          broken_references: activeCitation?.brokenReferences ?? [],
          formatting_errors: activeCitation?.formattingErrors ?? [],
        },
        plagiarism: {
          risk_level: activePlagiarism?.riskLevel ?? 'green',
          flagged_sections: activePlagiarism?.flaggedSections ?? [],
        },
      },
      history: {
        progress: progressHistory,
        plagiarism: plagiarismHistory,
        timeline,
      },
      comparison,
      ai_review: aiReview,
      submissions: submissions.map((submission) => ({
        id: submission.id,
        version_number: submission.versionNumber,
        status: submission.status,
        created_at: submission.createdAt.toISOString(),
      })),
    };
  }

  async submitProfessorReview(
    professorId: string,
    thesisId: string,
    input: { action: ReviewAction; feedback?: string },
  ): Promise<Record<string, unknown>> {
    const thesis = await this.findProfessorScopedThesisById(professorId, thesisId);

    const feedback = input.feedback?.trim() ?? '';
    if (
      (input.action === 'return_to_student' || input.action === 'request_revisions') &&
      feedback.length < 8
    ) {
      throw new BadRequestException('Feedback is required when returning work for revisions.');
    }

    if (feedback) {
      thesis.latestProfessorFeedback = feedback;
    }

    let nextStatus: ThesisStatus | null = null;
    if (input.action === 'return_to_student' || input.action === 'request_revisions') {
      nextStatus = ThesisStatus.RETURNED_TO_STUDENT;
    } else if (input.action === 'approve_milestone') {
      nextStatus = ThesisStatus.SUPERVISED;
    } else if (input.action === 'mark_complete') {
      nextStatus = ThesisStatus.COMPLETED;
    }

    if (nextStatus) {
      thesis.status = nextStatus;
    }

    if (feedback || nextStatus) {
      thesis.latestFeedbackAt = new Date();
    }

    const saved = await this.thesisRepository.save(thesis);
    return {
      thesis: {
        id: saved.id,
        status: saved.status,
        status_label: this.getStatusLabel(saved.status),
      },
      latest_professor_feedback: {
        text: saved.latestProfessorFeedback,
        timestamp: saved.latestFeedbackAt?.toISOString() ?? null,
      },
    };
  }

  async getProfessorAnalytics(professorId: string): Promise<Record<string, unknown>> {
    const snapshots = await this.buildProfessorSnapshots(professorId);
    const thesisIds = snapshots.map((snapshot) => snapshot.thesis.id);

    if (thesisIds.length === 0) {
      return {
        totals: {
          supervised_students: 0,
          average_progress_score: 0,
          at_risk_count: 0,
        },
        risk_distribution: {
          green: 0,
          yellow: 0,
          red: 0,
        },
        progress_trend: [],
        submission_activity: [],
        at_risk_students: [],
      };
    }

    const submissions = await this.submissionRepository.find({
      where: { thesisId: In(thesisIds) },
      order: { createdAt: 'ASC' },
    });

    const submissionIds = submissions.map((submission) => submission.id);
    const analyses = submissionIds.length
      ? await this.thesisAnalysisRepository.find({ where: { submissionId: In(submissionIds) } })
      : [];
    const analysisBySubmission = new Map(
      analyses.map((analysis) => [analysis.submissionId, analysis]),
    );

    const progressByDate = new Map<string, { total: number; count: number }>();
    const activityByDate = new Map<string, number>();

    for (const submission of submissions) {
      const dateKey = submission.createdAt.toISOString().slice(0, 10);
      activityByDate.set(dateKey, (activityByDate.get(dateKey) ?? 0) + 1);

      const analysis = analysisBySubmission.get(submission.id);
      if (!analysis) {
        continue;
      }

      const aggregate = progressByDate.get(dateKey) ?? { total: 0, count: 0 };
      aggregate.total += analysis.progressScore;
      aggregate.count += 1;
      progressByDate.set(dateKey, aggregate);
    }

    const riskDistribution = snapshots.reduce(
      (distribution, snapshot) => {
        distribution[snapshot.risk.level] += 1;
        return distribution;
      },
      { green: 0, yellow: 0, red: 0 },
    );

    const averageProgressScore =
      snapshots.reduce(
        (total, snapshot) => total + (snapshot.latestAnalysis?.progressScore ?? 0),
        0,
      ) / Math.max(1, snapshots.length);

    return {
      totals: {
        supervised_students: snapshots.length,
        average_progress_score: Math.round(averageProgressScore),
        at_risk_count: snapshots.filter((snapshot) => snapshot.risk.level !== 'green').length,
      },
      risk_distribution: riskDistribution,
      progress_trend: [...progressByDate.entries()]
        .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
        .map(([date, aggregate]) => ({
          date,
          average_progress: Math.round(aggregate.total / Math.max(1, aggregate.count)),
          samples: aggregate.count,
        })),
      submission_activity: [...activityByDate.entries()]
        .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
        .map(([date, count]) => ({
          date,
          submissions: count,
        })),
      at_risk_students: snapshots
        .filter((snapshot) => snapshot.risk.level !== 'green')
        .map((snapshot) => ({
          thesis_id: snapshot.thesis.id,
          student_name: snapshot.student?.fullName ?? 'Unknown Student',
          thesis_title: snapshot.thesis.title,
          risk_level: snapshot.risk.level,
          risk_reasons: snapshot.risk.reasons,
        })),
    };
  }

  private async buildProfessorSnapshots(professorId: string): Promise<ProfessorStudentSnapshot[]> {
    const theses = await this.getProfessorScopedTheses(professorId);

    if (theses.length === 0) {
      return [];
    }

    const thesisIds = theses.map((thesis) => thesis.id);
    const studentIds = theses.map((thesis) => thesis.studentId);

    const [students, submissions] = await Promise.all([
      this.userRepository.find({
        where: { id: In(studentIds) },
      }),
      this.submissionRepository.find({
        where: { thesisId: In(thesisIds) },
        order: { versionNumber: 'DESC' },
      }),
    ]);

    const studentById = new Map(students.map((student) => [student.id, student]));
    const latestSubmissionByThesis = new Map<string, Submission>();

    for (const submission of submissions) {
      if (!latestSubmissionByThesis.has(submission.thesisId)) {
        latestSubmissionByThesis.set(submission.thesisId, submission);
      }
    }

    const latestSubmissionIds = [...latestSubmissionByThesis.values()].map(
      (submission) => submission.id,
    );
    const [analyses, plagiarismReports] = await Promise.all([
      latestSubmissionIds.length
        ? this.thesisAnalysisRepository.find({ where: { submissionId: In(latestSubmissionIds) } })
        : Promise.resolve([]),
      latestSubmissionIds.length
        ? this.plagiarismReportRepository.find({ where: { submissionId: In(latestSubmissionIds) } })
        : Promise.resolve([]),
    ]);

    const analysisBySubmissionId = new Map(
      analyses.map((analysis) => [analysis.submissionId, analysis]),
    );
    const plagiarismBySubmissionId = new Map(
      plagiarismReports.map((plagiarism) => [plagiarism.submissionId, plagiarism]),
    );

    return theses.map((thesis) => {
      const latestSubmission = latestSubmissionByThesis.get(thesis.id) ?? null;
      const latestAnalysis = latestSubmission
        ? (analysisBySubmissionId.get(latestSubmission.id) ?? null)
        : null;
      const latestPlagiarism = latestSubmission
        ? (plagiarismBySubmissionId.get(latestSubmission.id) ?? null)
        : null;

      const risk = this.buildRiskAssessment({
        progressScore: latestAnalysis?.progressScore ?? null,
        trendDelta: latestAnalysis?.trendDelta ?? null,
        similarityPercent: latestPlagiarism?.similarityPercent ?? null,
        lastSubmissionAt: latestSubmission?.createdAt ?? null,
      });

      return {
        thesis,
        student: studentById.get(thesis.studentId) ?? null,
        latestSubmission,
        latestAnalysis,
        latestPlagiarism,
        risk,
      };
    });
  }

  private async getProfessorScopedTheses(professorId: string): Promise<Thesis[]> {
    const studentIds = await this.cohortsService.getProfessorScopedStudentIds(professorId);
    const enrolledTheses = studentIds.length
      ? await this.thesisRepository.find({
          where: { studentId: In(studentIds) },
          order: { updatedAt: 'DESC' },
        })
      : [];

    const enrolledStudentIds = new Set(enrolledTheses.map((thesis) => thesis.studentId));
    const legacySupervisorTheses = await this.thesisRepository.find({
      where: { supervisorId: professorId },
      order: { updatedAt: 'DESC' },
    });

    const backfillTargets = legacySupervisorTheses.filter(
      (thesis) => !enrolledStudentIds.has(thesis.studentId),
    );
    await Promise.all(
      backfillTargets.map((thesis) =>
        this.cohortsService.ensureEnrollmentInProfessorDefaultCohort(professorId, thesis.studentId),
      ),
    );

    const uniqueById = new Map<string, Thesis>();
    for (const thesis of [...enrolledTheses, ...legacySupervisorTheses]) {
      uniqueById.set(thesis.id, thesis);
    }

    return [...uniqueById.values()].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
  }

  private async findProfessorScopedThesisById(
    professorId: string,
    thesisId: string,
  ): Promise<Thesis> {
    const thesis = await this.thesisRepository.findOne({ where: { id: thesisId } });
    if (!thesis) {
      throw new NotFoundException('Thesis not found for this professor.');
    }

    if (thesis.supervisorId === professorId) {
      await this.cohortsService.ensureEnrollmentInProfessorDefaultCohort(
        professorId,
        thesis.studentId,
      );
      return thesis;
    }

    const hasScope = await this.cohortsService.isStudentInProfessorScope(
      professorId,
      thesis.studentId,
    );
    if (!hasScope) {
      throw new NotFoundException('Thesis not found for this professor.');
    }

    return thesis;
  }

  private buildRiskAssessment(input: {
    progressScore: number | null;
    trendDelta: number | null;
    similarityPercent: number | null;
    lastSubmissionAt: Date | null;
  }): RiskAssessment {
    const reasons: string[] = [];

    if (input.progressScore !== null && input.progressScore < 55) {
      reasons.push('Low progress score');
    }

    if (input.trendDelta !== null && input.trendDelta < -3) {
      reasons.push('Declining progress trend');
    }

    if (input.similarityPercent !== null && input.similarityPercent >= 30) {
      reasons.push('High similarity score');
    }

    if (!input.lastSubmissionAt) {
      reasons.push('No submissions available');
    } else {
      const ageDays = Math.floor(
        (Date.now() - input.lastSubmissionAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (ageDays > 21) {
        reasons.push('No recent submission');
      }
    }

    if (reasons.length === 0) {
      return { level: 'green', reasons: [] };
    }

    if (
      (input.progressScore !== null && input.progressScore < 45) ||
      (input.similarityPercent !== null && input.similarityPercent >= 45) ||
      reasons.length >= 2
    ) {
      return { level: 'red', reasons };
    }

    return { level: 'yellow', reasons };
  }

  private buildProfessorStatusNote(snapshot: ProfessorStudentSnapshot): string {
    const progress = snapshot.latestAnalysis?.progressScore ?? 0;
    const trend = snapshot.latestAnalysis?.trendDelta ?? 0;
    const similarity = snapshot.latestPlagiarism?.similarityPercent ?? 0;
    const alignment = snapshot.latestAnalysis?.abstractAlignmentVerdict ?? 'insufficient_data';

    if (!snapshot.latestSubmission) {
      return 'No submissions yet; waiting for first draft.';
    }
    if (similarity >= 45) {
      return 'High similarity risk; investigate source overlap and citation quality.';
    }
    if (progress < 55) {
      return 'Core thesis structure still weak; targeted revisions are needed.';
    }
    if (trend < 0) {
      return 'Quality trend declined versus prior draft; review recent changes.';
    }
    if (alignment === 'needs_realignment') {
      return 'Draft diverges from proposal; refocus argument and section coherence.';
    }
    if (progress >= 75 && similarity < 25) {
      return 'Steady progress with manageable risk; focus on refinement.';
    }
    return 'Mixed signals; continue supervision with focused milestone feedback.';
  }

  private async buildProfessorAiReview(input: {
    thesis: Thesis;
    activeSubmission: Submission | null;
    previousSubmission: Submission | null;
    activeAnalysis: ThesisAnalysis | null;
    activeCitation: CitationReport | null;
    activePlagiarism: PlagiarismReport | null;
    activeMilestoneStage: string | null;
    comparison: {
      additions: number;
      deletions: number;
      major_edits: number;
    } | null;
  }): Promise<ProfessorAiReviewSummary | null> {
    if (!input.activeSubmission || !input.activeAnalysis) {
      return null;
    }

    const fallback = this.buildProfessorAiReviewFallback(input);
    if (!this.azureOpenAi.isAvailable()) {
      return fallback;
    }

    const aiSummary = await this.azureOpenAi.summarizeProfessorReview({
      thesisTitle: input.thesis.title,
      abstract: input.thesis.abstract,
      previousText: input.previousSubmission?.extractedText ?? null,
      currentText: input.activeSubmission.extractedText ?? null,
      milestoneStage: input.activeMilestoneStage,
      progressScore: input.activeAnalysis.progressScore,
      trendDelta: input.activeAnalysis.trendDelta,
      citationHealthScore: input.activeCitation?.citationHealthScore ?? 0,
      similarityPercent: input.activePlagiarism?.similarityPercent ?? 0,
      additions: input.comparison?.additions ?? input.activeAnalysis.additionsCount,
      deletions: input.comparison?.deletions ?? input.activeAnalysis.deletionsCount,
      majorEdits: input.comparison?.major_edits ?? input.activeAnalysis.majorEditsCount,
      abstractAlignmentVerdict: input.activeAnalysis.abstractAlignmentVerdict,
      keyTopicCoverage: input.activeAnalysis.keyTopicCoverage ?? [],
      missingCoreSections: input.activeAnalysis.missingCoreSections ?? [],
    });

    if (!aiSummary) {
      return fallback;
    }

    return {
      status_note: aiSummary.status_note,
      change_summary: aiSummary.change_summary,
      recommended_feedback: aiSummary.recommended_feedback,
      stage_context: input.activeMilestoneStage,
    };
  }

  private buildProfessorAiReviewFallback(input: {
    activeAnalysis: ThesisAnalysis | null;
    activeCitation: CitationReport | null;
    activePlagiarism: PlagiarismReport | null;
    activeMilestoneStage: string | null;
    comparison: {
      additions: number;
      deletions: number;
      major_edits: number;
    } | null;
  }): ProfessorAiReviewSummary {
    const analysis = input.activeAnalysis;
    const citation = input.activeCitation;
    const plagiarism = input.activePlagiarism;

    const progress = analysis?.progressScore ?? 0;
    const trend = analysis?.trendDelta ?? 0;
    const additions = input.comparison?.additions ?? analysis?.additionsCount ?? 0;
    const deletions = input.comparison?.deletions ?? analysis?.deletionsCount ?? 0;
    const majorEdits = input.comparison?.major_edits ?? analysis?.majorEditsCount ?? 0;
    const missing = analysis?.missingCoreSections ?? [];
    const coverage = analysis?.keyTopicCoverage ?? [];

    const status_note =
      progress >= 75
        ? 'Strong progress; focus now on precision and defence readiness.'
        : progress >= 55
          ? 'Moderate progress; key structural and evidence gaps remain.'
          : 'At-risk draft; major revision and tighter structure needed.';

    const change_summary = [
      `Revision profile: +${additions} additions, -${deletions} deletions, ${majorEdits} major edits.`,
      `Progress is ${progress}% (${trend >= 0 ? '+' : ''}${trend} vs previous).`,
      `Abstract alignment is "${analysis?.abstractAlignmentVerdict ?? 'insufficient_data'}".`,
      coverage.length > 0
        ? `Coverage improved in: ${coverage.slice(0, 3).join(', ')}.`
        : 'Topic coverage remains limited in this draft.',
      missing.length > 0
        ? `Critical missing sections: ${missing.slice(0, 3).join(', ')}.`
        : 'No critical missing core sections were detected.',
      `Citation health is ${citation?.citationHealthScore ?? 0}% and similarity is ${plagiarism?.similarityPercent ?? 0}%.`,
    ].join(' ');

    const recommended_feedback: string[] = [];
    if (input.activeMilestoneStage) {
      recommended_feedback.push(
        `For "${input.activeMilestoneStage}", tighten the draft around milestone-specific deliverables before next submission.`,
      );
    }
    if (missing.length > 0) {
      recommended_feedback.push(
        `Prioritize completing the missing core sections: ${missing.slice(0, 2).join(', ')}.`,
      );
    }
    if ((citation?.issuesCount ?? 0) > 0) {
      recommended_feedback.push(
        'Fix citation quality issues by adding missing references and correcting formatting inconsistencies.',
      );
    }
    if ((plagiarism?.similarityPercent ?? 0) >= 30) {
      recommended_feedback.push(
        'Rework high-similarity passages with original synthesis and tighter source attribution.',
      );
    }
    if (recommended_feedback.length < 3) {
      recommended_feedback.push(
        'Strengthen evidence-to-claim links in each major section and explicitly defend methodology choices.',
      );
    }
    if (recommended_feedback.length < 3) {
      recommended_feedback.push(
        'Add a short limitations and future-work argument to improve examiner readiness.',
      );
    }

    return {
      status_note,
      change_summary,
      recommended_feedback: recommended_feedback.slice(0, 5),
      stage_context: input.activeMilestoneStage,
    };
  }

  private async resolveActiveMilestoneForThesis(thesis: Thesis): Promise<{
    id: string;
    title: string;
    stage: string;
    dueDate: string;
    dueInDays: number;
  } | null> {
    const scopedCohortIds = thesis.supervisorId
      ? await this.cohortsService.getStudentCohortIdsForProfessor(
          thesis.studentId,
          thesis.supervisorId,
        )
      : [];
    const cohortIds =
      scopedCohortIds.length > 0
        ? scopedCohortIds
        : await this.cohortsService.getStudentCohortIds(thesis.studentId);

    if (cohortIds.length === 0) {
      return null;
    }

    const milestones = await this.milestoneRepository.find({
      where: { cohortId: In(cohortIds) },
      order: { dueDate: 'ASC', createdAt: 'ASC' },
    });
    if (milestones.length === 0) {
      return null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const upcoming =
      milestones.find((milestone) => milestone.dueDate >= today) ?? milestones.at(-1) ?? null;
    if (!upcoming) {
      return null;
    }

    const dueTime = new Date(upcoming.dueDate).getTime();
    const dueInDays = Number.isNaN(dueTime)
      ? 0
      : Math.ceil((dueTime - Date.now()) / (24 * 60 * 60 * 1000));

    return {
      id: upcoming.id,
      title: upcoming.title,
      stage: upcoming.stage,
      dueDate: upcoming.dueDate,
      dueInDays,
    };
  }

  private getMilestoneStatusLabel(status: ThesisStatus): string {
    const labels: Record<ThesisStatus, string> = {
      [ThesisStatus.DRAFT]: 'Pending Student Submission',
      [ThesisStatus.SUPERVISED]: 'Approved by Professor',
      [ThesisStatus.SUBMITTED_TO_PROF]: 'Submitted to Professor',
      [ThesisStatus.RETURNED_TO_STUDENT]: 'Returned for Revisions',
      [ThesisStatus.COMPLETED]: 'Completed',
    };

    return labels[status];
  }

  private validateAbstractFile(file: UploadedProposalFile): void {
    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('Abstract/proposal file must be 20MB or less.');
    }

    const acceptedMimeTypes = new Set([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
    ]);

    if (acceptedMimeTypes.has(file.mimetype)) {
      return;
    }

    const name = file.originalname.toLowerCase();
    if (
      name.endsWith('.pdf') ||
      name.endsWith('.docx') ||
      name.endsWith('.txt') ||
      name.endsWith('.md')
    ) {
      return;
    }

    throw new BadRequestException('Only PDF, DOCX, TXT, and MD files are supported.');
  }

  private async extractAbstractText(file: UploadedProposalFile): Promise<string> {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      const parsed = await this.extractPdfText(file.buffer);
      if (parsed) return parsed;
      throw new BadRequestException(
        'Could not extract readable text from this PDF. Please upload TXT/MD or try another PDF.',
      );
    }

    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.originalname.toLowerCase().endsWith('.docx')
    ) {
      const parsed = await this.extractDocxText(file.buffer);
      if (parsed) return parsed;
      throw new BadRequestException(
        'Could not extract readable text from this DOCX. Please upload TXT/MD or try another DOCX.',
      );
    }

    const text = file.buffer.toString('utf8');
    if (this.isLikelyBinaryText(text)) {
      throw new BadRequestException(
        'Uploaded file appears to be binary/non-text. Please use PDF, DOCX, TXT, or MD.',
      );
    }
    return text;
  }

  private async extractPdfText(buffer: Buffer): Promise<string | null> {
    try {
      const pdfParse: (input: Buffer) => Promise<{ text?: string }> = runtimeRequire('pdf-parse');
      const parsed = await pdfParse(buffer);
      return parsed.text?.trim() || null;
    } catch {
      return null;
    }
  }

  private async extractDocxText(buffer: Buffer): Promise<string | null> {
    try {
      const mammoth: {
        extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
      } = runtimeRequire('mammoth');
      const parsed = await mammoth.extractRawText({ buffer });
      return parsed.value?.trim() || null;
    } catch {
      return null;
    }
  }

  private isLikelyBinaryText(text: string): boolean {
    if (!text || text.length < 100) {
      return false;
    }

    let nonPrintable = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      const isPrintableAscii =
        code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
      if (!isPrintableAscii) {
        nonPrintable += 1;
      }
    }

    return nonPrintable / text.length > 0.22;
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

  private buildPdfViewPaths(
    activeSubmission: Submission | null,
    previousSubmission: Submission | null,
    analysis: ThesisAnalysis | null,
  ): {
    previous_pdf_url: string | null;
    current_pdf_url: string | null;
    changes: Array<{
      id: string;
      label: string;
      type: 'addition' | 'removal' | 'edit';
      preview: string;
    }>;
  } {
    const changes = this.buildChangeMarkers(
      analysis?.previousExcerpt ?? '',
      analysis?.currentExcerpt ?? '',
    );

    const toProxyPath = (submission: Submission | null): string | null => {
      if (!submission) return null;
      if (!submission.fileKey.toLowerCase().endsWith('.pdf')) return null;
      return `/submissions/${submission.id}/file`;
    };

    return {
      previous_pdf_url: toProxyPath(previousSubmission),
      current_pdf_url: toProxyPath(activeSubmission),
      changes,
    };
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

    const { lines: previousLines, truncated: previousTruncated } =
      this.normalizeDiffLines(previousText);
    const { lines: currentLines, truncated: currentTruncated } =
      this.normalizeDiffLines(currentText);

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
    maxLines?: number,
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
    if (!maxLines || normalized.length <= maxLines) {
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
