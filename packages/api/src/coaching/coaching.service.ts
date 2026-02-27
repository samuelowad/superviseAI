import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AzureOpenAiService } from '../integrations/azure/azure-openai.service';
import { AzureSpeechService } from '../integrations/azure/azure-speech.service';
import { Submission } from '../submissions/entities/submission.entity';
import { Thesis } from '../theses/entities/thesis.entity';
import {
  CoachingMode,
  CoachingSession,
  TranscriptMessage,
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
  ) {}

  async start(studentId: string, dto: StartCoachingDto): Promise<Record<string, unknown>> {
    const thesis = dto.thesis_id
      ? await this.thesisRepository.findOne({ where: { id: dto.thesis_id, studentId } })
      : await this.thesisRepository.findOne({ where: { studentId } });

    if (!thesis) {
      throw new NotFoundException('No thesis found for this student.');
    }

    const mode: CoachingMode = dto.mode ?? 'mock_viva';

    // Get extracted text from the most recent submission
    const latestSubmission = await this.submissionRepository.findOne({
      where: { thesisId: thesis.id },
      order: { versionNumber: 'DESC' },
    });
    const thesisText = latestSubmission?.extractedText ?? '';

    // Generate thesis-specific questions using AI
    const questions = await this.azureOpenAi.generateCoachQuestions({
      thesisText,
      abstract: thesis.abstract,
      mode,
      count: 10,
    });

    const firstQuestion = questions[0] ?? 'Tell me about your thesis research.';

    const transcript: TranscriptMessage[] = [{ role: 'assistant', content: firstQuestion }];

    const session = this.coachingSessionRepository.create({
      thesisId: thesis.id,
      mode,
      transcript,
      generatedQuestions: questions,
      readinessScore: null,
      weakTopics: [],
    });

    const saved = await this.coachingSessionRepository.save(session);

    return {
      session_id: saved.id,
      thesis_id: thesis.id,
      mode,
      question_index: 1,
      total_questions: questions.length,
      ai_message: firstQuestion,
    };
  }

  async message(studentId: string, dto: SendMessageDto): Promise<Record<string, unknown>> {
    const session = await this.coachingSessionRepository.findOne({ where: { id: dto.session_id } });
    if (!session) {
      throw new NotFoundException('Coaching session not found.');
    }

    const thesis = await this.thesisRepository.findOne({
      where: { id: session.thesisId, studentId },
    });
    if (!thesis) {
      throw new NotFoundException('Coaching session not found for this student.');
    }

    const currentTranscript = session.transcript ?? [];
    const questionCount = currentTranscript.filter((e) => e.role === 'assistant').length;
    const totalQuestions = session.generatedQuestions?.length ?? 10;

    if (questionCount >= totalQuestions) {
      throw new BadRequestException(
        'Session already completed. End the session to get summary feedback.',
      );
    }

    // Intent guard — reject off-topic or malicious messages
    const thesisTitle = thesis.title ?? 'this thesis';
    const intent = await this.azureOpenAi.checkIntentGuard(dto.content, thesisTitle);

    if (intent === 'off_topic' || intent === 'malicious_or_irrelevant') {
      const guardMessage =
        intent === 'malicious_or_irrelevant'
          ? "Let's keep focused on your thesis. I can only help with coaching for your research."
          : "That's outside the scope of this session. Let's stay focused on your thesis defence.";

      const userMessage: TranscriptMessage = { role: 'student', content: dto.content };
      const aiMessage: TranscriptMessage = { role: 'assistant', content: guardMessage };
      session.transcript = [...currentTranscript, userMessage, aiMessage];
      await this.coachingSessionRepository.save(session);

      return {
        session_id: session.id,
        ai_message: guardMessage,
        question_index: questionCount,
        total_questions: totalQuestions,
        intent_blocked: true,
      };
    }

    const latestSub = await this.submissionRepository.findOne({
      where: { thesisId: thesis.id },
      order: { versionNumber: 'DESC' },
    });
    const thesisText = latestSub?.extractedText ?? '';
    const nextQuestion = session.generatedQuestions?.[questionCount] ?? null;

    // Generate AI coaching response (filter out system messages)
    const coachTranscript = currentTranscript.filter(
      (t): t is { role: 'assistant' | 'student'; content: string } =>
        t.role === 'assistant' || t.role === 'student',
    );
    const aiResponse = await this.azureOpenAi.coachResponse({
      thesisContext: thesisText,
      abstract: thesis.abstract,
      mode: session.mode,
      transcript: coachTranscript,
      userMessage: dto.content,
      nextQuestion: nextQuestion ?? undefined,
    });

    const responseContent =
      aiResponse ??
      (nextQuestion
        ? `Good point. ${nextQuestion}`
        : 'Thank you. You have covered all the questions — use End Session to get your score.');

    const userMessage: TranscriptMessage = { role: 'student', content: dto.content };
    const aiMessage: TranscriptMessage = { role: 'assistant', content: responseContent };

    session.transcript = [...currentTranscript, userMessage, aiMessage];
    await this.coachingSessionRepository.save(session);

    return {
      session_id: session.id,
      ai_message: responseContent,
      question_index: questionCount + 1,
      total_questions: totalQuestions,
    };
  }

  async end(studentId: string, dto: EndSessionDto): Promise<Record<string, unknown>> {
    const session = await this.coachingSessionRepository.findOne({ where: { id: dto.session_id } });
    if (!session) {
      throw new NotFoundException('Coaching session not found.');
    }

    const thesis = await this.thesisRepository.findOne({
      where: { id: session.thesisId, studentId },
    });
    if (!thesis) {
      throw new NotFoundException('Coaching session not found for this student.');
    }

    // Use AI evaluation if available, otherwise fall back to heuristic
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
      const answerLengths = studentMessages.map((e) => e.content.trim().length);
      const averageLength =
        answerLengths.length > 0
          ? answerLengths.reduce((sum, n) => sum + n, 0) / answerLengths.length
          : 0;

      readinessScore = Math.max(
        40,
        Math.min(96, 45 + studentMessages.length * 4 + Math.round(averageLength / 40)),
      );
      weakTopics = [];
      if (averageLength < 120) weakTopics.push('depth_of_argumentation');
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

    return {
      session_id: session.id,
      readiness_score: readinessScore,
      weak_topics: weakTopics,
      recommendation,
    };
  }

  async voice(
    studentId: string,
    audioBuffer: Buffer,
    sessionId: string,
    contentType: string,
  ): Promise<Record<string, unknown>> {
    const session = await this.coachingSessionRepository.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Coaching session not found.');
    }

    const thesis = await this.thesisRepository.findOne({
      where: { id: session.thesisId, studentId },
    });
    if (!thesis) {
      throw new NotFoundException('Coaching session not found for this student.');
    }

    if (!this.azureSpeech.isAvailable()) {
      throw new BadRequestException(
        'Voice features are not available (Azure Speech not configured).',
      );
    }

    const transcript = await this.azureSpeech.speechToText(audioBuffer, contentType);
    if (!transcript) {
      throw new BadRequestException('Could not transcribe audio. Please try again.');
    }

    // Process the transcribed message through normal message flow
    const result = await this.message(studentId, { session_id: sessionId, content: transcript });

    return {
      ...result,
      transcribed_text: transcript,
    };
  }

  async tts(text: string): Promise<Buffer | null> {
    if (!this.azureSpeech.isAvailable()) return null;
    return this.azureSpeech.textToSpeech(text);
  }

  async latestByThesis(studentId: string, thesisId: string): Promise<Record<string, unknown>> {
    const thesis = await this.thesisRepository.findOne({ where: { id: thesisId, studentId } });
    if (!thesis) {
      throw new NotFoundException('Thesis not found for this student.');
    }

    const session = await this.coachingSessionRepository.findOne({
      where: { thesisId },
      order: { createdAt: 'DESC' },
    });

    return { session };
  }
}
