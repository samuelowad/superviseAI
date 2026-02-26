import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Thesis } from '../theses/entities/thesis.entity';
import { CoachingSession, TranscriptMessage } from './entities/coaching-session.entity';
import { EndSessionDto } from './dto/end-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartCoachingDto } from './dto/start-coaching.dto';

const QUESTION_BANK = [
  'Summarize your thesis in one minute for an examiner panel.',
  'Which methodological choice is most vulnerable to criticism, and why did you still choose it?',
  'What is the strongest evidence supporting your core argument?',
  'What counterargument would you raise against your own findings?',
  'Which limitation should examiners care about most?',
  'How does your work extend existing literature beyond replication?',
  'If one result is challenged, how does your conclusion change?',
  'What would be your next research step after this thesis?',
  'Which citation in your work is most critical to defend under pressure?',
  'Why should your thesis matter to practitioners, not only academics?',
];

@Injectable()
export class CoachingService {
  constructor(
    @InjectRepository(Thesis)
    private readonly thesisRepository: Repository<Thesis>,
    @InjectRepository(CoachingSession)
    private readonly coachingSessionRepository: Repository<CoachingSession>,
  ) {}

  async start(studentId: string, dto: StartCoachingDto): Promise<Record<string, unknown>> {
    const thesis = dto.thesis_id
      ? await this.thesisRepository.findOne({ where: { id: dto.thesis_id, studentId } })
      : await this.thesisRepository.findOne({ where: { studentId } });

    if (!thesis) {
      throw new NotFoundException('No thesis found for this student.');
    }

    const transcript: TranscriptMessage[] = [
      {
        role: 'assistant',
        content: QUESTION_BANK[0],
      },
    ];

    const session = this.coachingSessionRepository.create({
      thesisId: thesis.id,
      transcript,
      readinessScore: null,
      weakTopics: [],
    });

    const saved = await this.coachingSessionRepository.save(session);

    return {
      session_id: saved.id,
      thesis_id: thesis.id,
      question_index: 1,
      total_questions: QUESTION_BANK.length,
      ai_message: QUESTION_BANK[0],
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
    const questionCount = currentTranscript.filter((entry) => entry.role === 'assistant').length;

    if (questionCount >= QUESTION_BANK.length) {
      throw new BadRequestException(
        'Session already completed. End the session to get summary feedback.',
      );
    }

    const userMessage: TranscriptMessage = {
      role: 'student',
      content: dto.content,
    };

    const nextQuestion = QUESTION_BANK[Math.min(questionCount, QUESTION_BANK.length - 1)];
    const aiMessage: TranscriptMessage = {
      role: 'assistant',
      content: nextQuestion,
    };

    session.transcript = [...currentTranscript, userMessage, aiMessage];
    await this.coachingSessionRepository.save(session);

    return {
      session_id: session.id,
      ai_message: aiMessage.content,
      question_index: questionCount + 1,
      total_questions: QUESTION_BANK.length,
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

    const studentMessages = (session.transcript ?? []).filter((entry) => entry.role === 'student');
    const answerLengths = studentMessages.map((entry) => entry.content.trim().length);

    const averageLength =
      answerLengths.length > 0
        ? answerLengths.reduce((sum, current) => sum + current, 0) / answerLengths.length
        : 0;

    const readinessScore = Math.max(
      40,
      Math.min(96, 45 + studentMessages.length * 4 + Math.round(averageLength / 40)),
    );

    const weakTopics: string[] = [];
    if (averageLength < 120) {
      weakTopics.push('depth_of_argumentation');
    }
    if (studentMessages.length < 5) {
      weakTopics.push('question_coverage');
    }
    if (weakTopics.length === 0) {
      weakTopics.push('none_detected');
    }

    session.readinessScore = readinessScore;
    session.weakTopics = weakTopics;
    await this.coachingSessionRepository.save(session);

    return {
      session_id: session.id,
      readiness_score: readinessScore,
      weak_topics: weakTopics,
      recommendation:
        readinessScore >= 75
          ? 'Strong viva readiness. Focus on defending limitations and future work.'
          : 'Needs additional practice. Expand evidence depth and counterargument defense.',
    };
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

    return {
      session,
    };
  }
}
