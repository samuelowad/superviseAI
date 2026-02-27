import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AzureCognitiveService } from '../integrations/azure/azure-cognitive.service';
import { AzureOpenAiService } from '../integrations/azure/azure-openai.service';
import { AzureSpeechService } from '../integrations/azure/azure-speech.service';
import { Submission } from '../submissions/entities/submission.entity';
import { Thesis } from '../theses/entities/thesis.entity';
import {
  CoachingMode,
  CoachingSession,
  DifficultyBand,
  LearnerProfile,
  TranscriptMessage,
  TurnMetric,
} from './entities/coaching-session.entity';
import { EndSessionDto } from './dto/end-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartCoachingDto } from './dto/start-coaching.dto';

@Injectable()
export class CoachingService {
  constructor(
    @InjectRepository(Thesis)
    private readonly thesisRepository: Repository<Thesis>,
    @InjectRepository(Submission)
    private readonly submissionRepository: Repository<Submission>,
    @InjectRepository(CoachingSession)
    private readonly coachingSessionRepository: Repository<CoachingSession>,
    private readonly azureOpenAi: AzureOpenAiService,
    private readonly azureSpeech: AzureSpeechService,
    private readonly azureCognitive: AzureCognitiveService,
  ) {}

  async start(studentId: string, dto: StartCoachingDto): Promise<Record<string, unknown>> {
    const thesis = dto.thesis_id
      ? await this.thesisRepository.findOne({ where: { id: dto.thesis_id, studentId } })
      : await this.thesisRepository.findOne({ where: { studentId } });

    if (!thesis) throw new NotFoundException('No thesis found for this student.');

    const mode: CoachingMode = dto.mode ?? 'mock_viva';
    const learnerProfile: LearnerProfile = dto.learner_profile ?? 'standard';

    const latestSubmission = await this.submissionRepository.findOne({
      where: { thesisId: thesis.id },
      order: { versionNumber: 'DESC' },
    });
    const thesisText = latestSubmission?.extractedText ?? '';

    const questions = await this.azureOpenAi.generateCoachQuestions({
      thesisText,
      abstract: thesis.abstract,
      mode,
      count: 10,
      learnerProfile,
    });

    const firstQuestion = questions[0] ?? 'Tell me about your thesis research.';

    const transcript: TranscriptMessage[] = [{ role: 'assistant', content: firstQuestion }];

    const session = this.coachingSessionRepository.create({
      thesisId: thesis.id,
      mode,
      learnerProfile,
      transcript,
      generatedQuestions: questions,
      turnMetrics: [],
      readinessScore: null,
      weakTopics: [],
    });

    const saved = await this.coachingSessionRepository.save(session);

    return {
      session_id: saved.id,
      thesis_id: thesis.id,
      mode,
      learner_profile: learnerProfile,
      question_index: 1,
      total_questions: questions.length,
      ai_message: firstQuestion,
    };
  }

  async message(studentId: string, dto: SendMessageDto): Promise<Record<string, unknown>> {
    const session = await this.coachingSessionRepository.findOne({ where: { id: dto.session_id } });
    if (!session) throw new NotFoundException('Coaching session not found.');

    const thesis = await this.thesisRepository.findOne({
      where: { id: session.thesisId, studentId },
    });
    if (!thesis) throw new NotFoundException('Coaching session not found for this student.');

    const currentTranscript = session.transcript ?? [];
    const questionCount = currentTranscript.filter((e) => e.role === 'assistant').length;
    const totalQuestions = session.generatedQuestions?.length ?? 10;

    if (questionCount >= totalQuestions) {
      throw new BadRequestException(
        'Session already completed. End the session to get summary feedback.',
      );
    }

    // ── Intent guard ──────────────────────────────────────────────────────────
    const intent = await this.azureOpenAi.checkIntentGuard(dto.content, thesis.title);
    if (intent === 'off_topic' || intent === 'malicious_or_irrelevant') {
      const guardMessage =
        intent === 'malicious_or_irrelevant'
          ? "Let's keep focused on your thesis. I can only help with coaching for your research."
          : "That's outside the scope of this session. Let's stay focused on your thesis defence.";

      session.transcript = [
        ...currentTranscript,
        { role: 'student', content: dto.content },
        { role: 'assistant', content: guardMessage },
      ];
      await this.coachingSessionRepository.save(session);

      return {
        session_id: session.id,
        ai_message: guardMessage,
        question_index: questionCount,
        total_questions: totalQuestions,
        intent_blocked: true,
      };
    }

    // ── Confidence & sentiment analysis ──────────────────────────────────────
    const [confidenceResult, latestSub] = await Promise.all([
      this.azureCognitive.analyzeConfidence(dto.content),
      this.submissionRepository.findOne({
        where: { thesisId: thesis.id },
        order: { versionNumber: 'DESC' },
      }),
    ]);

    const thesisText = latestSub?.extractedText ?? '';
    const difficultyBand = this.deriveDifficulty(
      confidenceResult.confidence,
      session.learnerProfile,
    );
    const nextQuestion = session.generatedQuestions?.[questionCount] ?? null;

    // ── Adaptive AI response ──────────────────────────────────────────────────
    const coachTranscript = currentTranscript.filter(
      (t): t is { role: 'assistant' | 'student'; content: string } =>
        t.role === 'assistant' || t.role === 'student',
    );

    const [aiResponse, turnScores] = await Promise.all([
      this.azureOpenAi.coachResponse({
        thesisContext: thesisText,
        abstract: thesis.abstract,
        mode: session.mode,
        transcript: coachTranscript,
        userMessage: dto.content,
        nextQuestion: nextQuestion ?? undefined,
        learnerProfile: session.learnerProfile,
        confidence: confidenceResult.confidence,
        difficultyBand,
      }),
      this.azureOpenAi.scoreTurn({
        studentAnswer: dto.content,
        question: coachTranscript[coachTranscript.length - 1]?.content ?? '',
        thesisTitle: thesis.title,
      }),
    ]);

    const scores = turnScores ?? this.heuristicScores(dto.content, confidenceResult.confidence);

    // ── Compute trend ─────────────────────────────────────────────────────────
    const priorMetrics = session.turnMetrics ?? [];
    const trend = this.computeTrend(priorMetrics, scores);

    const turnMetric: TurnMetric = {
      turn_index: questionCount,
      timestamp: new Date().toISOString(),
      sentiment: confidenceResult.sentiment,
      confidence: confidenceResult.confidence,
      difficulty: difficultyBand,
      hesitation_signals: confidenceResult.hesitationSignals,
      scores,
      trend,
    };

    const responseContent =
      aiResponse ??
      (nextQuestion
        ? `Good point. ${nextQuestion}`
        : 'Thank you. You have covered all the questions — use End Session to get your score.');

    session.transcript = [
      ...currentTranscript,
      { role: 'student', content: dto.content },
      { role: 'assistant', content: responseContent },
    ];
    session.turnMetrics = [...priorMetrics, turnMetric];
    await this.coachingSessionRepository.save(session);

    return {
      session_id: session.id,
      ai_message: responseContent,
      question_index: questionCount + 1,
      total_questions: totalQuestions,
      live_metrics: {
        turn: questionCount,
        confidence: confidenceResult.confidence,
        sentiment: confidenceResult.sentiment,
        difficulty: difficultyBand,
        scores,
        trend,
        hesitation_signals: confidenceResult.hesitationSignals,
      },
    };
  }

  async end(studentId: string, dto: EndSessionDto): Promise<Record<string, unknown>> {
    const session = await this.coachingSessionRepository.findOne({ where: { id: dto.session_id } });
    if (!session) throw new NotFoundException('Coaching session not found.');

    const thesis = await this.thesisRepository.findOne({
      where: { id: session.thesisId, studentId },
    });
    if (!thesis) throw new NotFoundException('Coaching session not found for this student.');

    // ── AI session evaluation ─────────────────────────────────────────────────
    const aiEval = await this.azureOpenAi.evaluateSession({
      transcript: session.transcript ?? [],
      thesisTitle: thesis.title,
      mode: session.mode,
    });

    let readinessScore: number;
    let weakTopics: string[];
    let recommendation: string;

    if (aiEval) {
      readinessScore = aiEval.readiness_score;
      weakTopics = aiEval.weak_topics;
      recommendation = aiEval.recommendation;
    } else {
      // Heuristic fallback
      const studentMessages = (session.transcript ?? []).filter((e) => e.role === 'student');
      const avgLength =
        studentMessages.length > 0
          ? studentMessages.reduce((s, e) => s + e.content.trim().length, 0) /
            studentMessages.length
          : 0;
      readinessScore = Math.max(
        40,
        Math.min(96, 45 + studentMessages.length * 4 + Math.round(avgLength / 40)),
      );
      weakTopics = avgLength < 120 ? ['depth_of_argumentation'] : [];
      if (studentMessages.length < 5) weakTopics.push('question_coverage');
      if (weakTopics.length === 0) weakTopics.push('none_detected');
      recommendation =
        readinessScore >= 75
          ? 'Strong viva readiness. Focus on defending limitations and future work.'
          : 'Needs additional practice. Expand evidence depth and counterargument defence.';
    }

    session.readinessScore = readinessScore;
    session.weakTopics = weakTopics;
    await this.coachingSessionRepository.save(session);

    // ── Build enriched summary from turn metrics ──────────────────────────────
    const metrics = session.turnMetrics ?? [];
    const dimensionSummary = this.aggregateDimensions(metrics);
    const progressDelta = this.computeProgressDelta(metrics);

    return {
      session_id: session.id,
      mode: session.mode,
      learner_profile: session.learnerProfile,
      readiness_score: readinessScore,
      weak_topics: weakTopics,
      recommendation,
      dimension_summary: dimensionSummary,
      progress_delta: progressDelta,
      turns_completed: metrics.length,
    };
  }

  async voice(
    studentId: string,
    audioBuffer: Buffer,
    sessionId: string,
    contentType: string,
  ): Promise<Record<string, unknown>> {
    const session = await this.coachingSessionRepository.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Coaching session not found.');

    const thesis = await this.thesisRepository.findOne({
      where: { id: session.thesisId, studentId },
    });
    if (!thesis) throw new NotFoundException('Coaching session not found for this student.');

    if (!this.azureSpeech.isAvailable()) {
      throw new BadRequestException(
        'Voice features are not available (Azure Speech not configured).',
      );
    }

    const transcript = await this.azureSpeech.speechToText(audioBuffer, contentType);
    if (!transcript) throw new BadRequestException('Could not transcribe audio. Please try again.');

    const result = await this.message(studentId, { session_id: sessionId, content: transcript });
    return { ...result, transcribed_text: transcript };
  }

  async tts(text: string): Promise<Buffer | null> {
    if (!this.azureSpeech.isAvailable()) return null;
    return this.azureSpeech.textToSpeech(text);
  }

  async latestByThesis(studentId: string, thesisId: string): Promise<Record<string, unknown>> {
    const thesis = await this.thesisRepository.findOne({ where: { id: thesisId, studentId } });
    if (!thesis) throw new NotFoundException('Thesis not found for this student.');

    const session = await this.coachingSessionRepository.findOne({
      where: { thesisId },
      order: { createdAt: 'DESC' },
    });

    return { session };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Map confidence score → difficulty band, adjusted by learner profile.
   */
  private deriveDifficulty(confidence: number, profile: LearnerProfile): DifficultyBand {
    // Advanced researchers always get elevated difficulty
    if (profile === 'advanced_researcher') {
      return confidence >= 50 ? 'hard' : 'medium';
    }
    // Anxious speakers cap at medium
    if (profile === 'anxious_speaker') {
      return confidence >= 70 ? 'medium' : 'easy';
    }
    // Standard + ESL
    if (confidence < 40) return 'easy';
    if (confidence < 70) return 'medium';
    return 'hard';
  }

  /**
   * Heuristic turn scores when GPT scoring is unavailable.
   */
  private heuristicScores(text: string, confidence: number): TurnMetric['scores'] {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const base = Math.min(75, 35 + words * 1.5);
    const spread = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
    return {
      argument_strength: spread(base + (confidence - 50) * 0.3),
      evidence_quality: spread(base - 5 + (confidence - 50) * 0.2),
      logical_consistency: spread(base + 2),
      clarity: spread(base + Math.min(10, words / 4)),
      confidence: spread(confidence),
    };
  }

  /**
   * Compare latest scores to prior average to determine trend.
   */
  private computeTrend(
    prior: TurnMetric[],
    current: TurnMetric['scores'],
  ): 'improving' | 'stable' | 'declining' {
    if (prior.length === 0) return 'stable';

    const priorAvg =
      prior.slice(-3).reduce((sum, m) => {
        const avg = Object.values(m.scores).reduce((a, b) => a + b, 0) / 5;
        return sum + avg;
      }, 0) / Math.min(3, prior.length);

    const currentAvg = Object.values(current).reduce((a, b) => a + b, 0) / 5;
    const delta = currentAvg - priorAvg;

    if (delta > 5) return 'improving';
    if (delta < -5) return 'declining';
    return 'stable';
  }

  /**
   * Aggregate dimension averages and first-vs-last delta for end report.
   */
  private aggregateDimensions(metrics: TurnMetric[]): Record<string, unknown> {
    if (metrics.length === 0) return {};

    const dims = [
      'argument_strength',
      'evidence_quality',
      'logical_consistency',
      'clarity',
      'confidence',
    ] as const;
    const averages: Record<string, number> = {};
    const first = metrics[0].scores;
    const last = metrics[metrics.length - 1].scores;
    const deltas: Record<string, number> = {};

    for (const dim of dims) {
      const avg = metrics.reduce((sum, m) => sum + m.scores[dim], 0) / metrics.length;
      averages[dim] = Math.round(avg);
      deltas[dim] = last[dim] - first[dim];
    }

    const bestImproved = dims.reduce((best, dim) => (deltas[dim] > deltas[best] ? dim : best));
    const weakestPersistent = dims.reduce((worst, dim) =>
      averages[dim] < averages[worst] ? dim : worst,
    );

    return {
      averages,
      first_turn: first,
      last_turn: last,
      deltas,
      best_improved: bestImproved,
      weakest_persistent: weakestPersistent,
    };
  }

  /**
   * Overall confidence trend across the session.
   */
  private computeProgressDelta(metrics: TurnMetric[]): number {
    if (metrics.length < 2) return 0;
    const first = Object.values(metrics[0].scores).reduce((a, b) => a + b, 0) / 5;
    const last = Object.values(metrics[metrics.length - 1].scores).reduce((a, b) => a + b, 0) / 5;
    return Math.round(last - first);
  }
}
