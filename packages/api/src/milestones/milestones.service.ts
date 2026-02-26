import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Cohort } from '../cohorts/entities/cohort.entity';
import { Enrollment } from '../cohorts/entities/enrollment.entity';
import { Submission, SubmissionStatus } from '../submissions/entities/submission.entity';
import { Thesis } from '../theses/entities/thesis.entity';
import { User, UserRole } from '../users/user.entity';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { Milestone } from './entities/milestone.entity';

@Injectable()
export class MilestonesService {
  constructor(
    @InjectRepository(Milestone)
    private readonly milestoneRepository: Repository<Milestone>,
    @InjectRepository(Cohort)
    private readonly cohortRepository: Repository<Cohort>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(Thesis)
    private readonly thesisRepository: Repository<Thesis>,
    @InjectRepository(Submission)
    private readonly submissionRepository: Repository<Submission>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async listForProfessor(
    professorId: string,
  ): Promise<{ milestones: Array<Record<string, unknown>> }> {
    const cohorts = await this.cohortRepository.find({
      where: { professorId },
      order: { createdAt: 'ASC' },
    });
    if (cohorts.length === 0) {
      return { milestones: [] };
    }

    const cohortsById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
    const milestones = await this.milestoneRepository.find({
      where: { cohortId: In(cohorts.map((cohort) => cohort.id)) },
      order: { dueDate: 'ASC', createdAt: 'ASC' },
    });

    const completion = await this.buildCompletionByMilestone(milestones);
    const now = Date.now();

    return {
      milestones: milestones.map((milestone) => {
        const dueMs = new Date(milestone.dueDate).getTime();
        const dueInDays = Number.isNaN(dueMs)
          ? null
          : Math.ceil((dueMs - now) / (24 * 60 * 60 * 1000));

        return {
          id: milestone.id,
          cohort_id: milestone.cohortId,
          cohort_name: cohortsById.get(milestone.cohortId)?.name ?? 'Unknown Cohort',
          title: milestone.title,
          stage: milestone.stage,
          due_date: milestone.dueDate,
          due_in_days: dueInDays,
          completion: completion.get(milestone.id) ?? {
            total_students: 0,
            completed_students: 0,
            pending_students: 0,
          },
          created_at: milestone.createdAt,
          updated_at: milestone.updatedAt,
        };
      }),
    };
  }

  async getCohortMilestones(
    cohortId: string,
    user: { id: string; role: UserRole },
  ): Promise<Record<string, unknown>> {
    const cohort = await this.cohortRepository.findOne({ where: { id: cohortId } });
    if (!cohort) {
      throw new NotFoundException('Cohort not found.');
    }

    if (user.role === UserRole.PROFESSOR && cohort.professorId !== user.id) {
      throw new NotFoundException('Cohort not found for this professor.');
    }

    if (user.role === UserRole.STUDENT) {
      const enrollment = await this.enrollmentRepository.findOne({
        where: { cohortId: cohort.id, studentId: user.id },
      });
      if (!enrollment) {
        throw new NotFoundException('Cohort not found for this student.');
      }
    }

    const milestones = await this.milestoneRepository.find({
      where: { cohortId: cohort.id },
      order: { dueDate: 'ASC', createdAt: 'ASC' },
    });

    const completionByMilestone = await this.buildDetailedCompletionByMilestone(
      cohort.id,
      milestones,
    );

    return {
      cohort: {
        id: cohort.id,
        name: cohort.name,
        citation_style: cohort.citationStyle,
      },
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        stage: milestone.stage,
        due_date: milestone.dueDate,
        created_at: milestone.createdAt,
        updated_at: milestone.updatedAt,
        student_completion: completionByMilestone.get(milestone.id) ?? {
          total_students: 0,
          completed_students: 0,
          pending_students: 0,
          students: [],
        },
      })),
    };
  }

  async createForProfessor(
    professorId: string,
    dto: CreateMilestoneDto,
  ): Promise<{ milestone: Record<string, unknown> }> {
    const cohort = await this.cohortRepository.findOne({
      where: { id: dto.cohort_id, professorId },
    });

    if (!cohort) {
      throw new NotFoundException('Cohort not found for this professor.');
    }

    const milestone = this.milestoneRepository.create({
      cohortId: cohort.id,
      title: dto.title.trim(),
      stage: dto.stage?.trim() || 'draft_review',
      dueDate: dto.due_date,
    });

    const saved = await this.milestoneRepository.save(milestone);
    return {
      milestone: {
        id: saved.id,
        cohort_id: saved.cohortId,
        title: saved.title,
        stage: saved.stage,
        due_date: saved.dueDate,
        created_at: saved.createdAt,
        updated_at: saved.updatedAt,
      },
    };
  }

  async updateForProfessor(
    professorId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
  ): Promise<{ milestone: Record<string, unknown> }> {
    const milestone = await this.milestoneRepository.findOne({
      where: { id: milestoneId },
    });

    if (!milestone) {
      throw new NotFoundException('Milestone not found for this professor.');
    }

    const cohort = await this.cohortRepository.findOne({
      where: { id: milestone.cohortId, professorId },
    });

    if (!cohort) {
      throw new NotFoundException('Milestone not found for this professor.');
    }

    if (dto.title !== undefined) {
      milestone.title = dto.title.trim();
    }

    if (dto.stage !== undefined) {
      milestone.stage = dto.stage.trim();
    }

    if (dto.due_date !== undefined) {
      milestone.dueDate = dto.due_date;
    }

    const saved = await this.milestoneRepository.save(milestone);

    return {
      milestone: {
        id: saved.id,
        cohort_id: saved.cohortId,
        title: saved.title,
        stage: saved.stage,
        due_date: saved.dueDate,
        created_at: saved.createdAt,
        updated_at: saved.updatedAt,
      },
    };
  }

  async findOne(milestoneId: string): Promise<Milestone | null> {
    return this.milestoneRepository.findOne({ where: { id: milestoneId } });
  }

  private async buildCompletionByMilestone(
    milestones: Milestone[],
  ): Promise<
    Map<string, { total_students: number; completed_students: number; pending_students: number }>
  > {
    const result = new Map<
      string,
      { total_students: number; completed_students: number; pending_students: number }
    >();

    if (milestones.length === 0) {
      return result;
    }

    const cohortIds = [...new Set(milestones.map((milestone) => milestone.cohortId))];
    const enrollments = await this.enrollmentRepository.find({
      where: { cohortId: In(cohortIds) },
    });

    const studentIdsByCohort = new Map<string, string[]>();
    for (const enrollment of enrollments) {
      const list = studentIdsByCohort.get(enrollment.cohortId) ?? [];
      list.push(enrollment.studentId);
      studentIdsByCohort.set(enrollment.cohortId, list);
    }

    const allStudentIds = [...new Set(enrollments.map((enrollment) => enrollment.studentId))];
    const theses = allStudentIds.length
      ? await this.thesisRepository.find({ where: { studentId: In(allStudentIds) } })
      : [];

    const thesisById = new Map(theses.map((thesis) => [thesis.id, thesis]));
    const thesisIds = theses.map((thesis) => thesis.id);

    const submissions = thesisIds.length
      ? await this.submissionRepository.find({
          where: {
            thesisId: In(thesisIds),
            milestoneId: In(milestones.map((milestone) => milestone.id)),
            status: SubmissionStatus.COMPLETE,
          },
        })
      : [];

    const completedByMilestone = new Map<string, Set<string>>();
    for (const submission of submissions) {
      const thesis = thesisById.get(submission.thesisId);
      if (!thesis || !submission.milestoneId) {
        continue;
      }

      const set = completedByMilestone.get(submission.milestoneId) ?? new Set<string>();
      set.add(thesis.studentId);
      completedByMilestone.set(submission.milestoneId, set);
    }

    for (const milestone of milestones) {
      const studentIds = studentIdsByCohort.get(milestone.cohortId) ?? [];
      const completeSet = completedByMilestone.get(milestone.id) ?? new Set<string>();
      result.set(milestone.id, {
        total_students: studentIds.length,
        completed_students: completeSet.size,
        pending_students: Math.max(0, studentIds.length - completeSet.size),
      });
    }

    return result;
  }

  private async buildDetailedCompletionByMilestone(
    cohortId: string,
    milestones: Milestone[],
  ): Promise<
    Map<
      string,
      {
        total_students: number;
        completed_students: number;
        pending_students: number;
        students: Array<Record<string, unknown>>;
      }
    >
  > {
    const result = new Map<
      string,
      {
        total_students: number;
        completed_students: number;
        pending_students: number;
        students: Array<Record<string, unknown>>;
      }
    >();

    const enrollments = await this.enrollmentRepository.find({
      where: { cohortId },
      order: { enrolledAt: 'ASC' },
    });

    const studentIds = enrollments.map((enrollment) => enrollment.studentId);
    const students = studentIds.length
      ? await this.userRepository.find({ where: { id: In(studentIds) } })
      : [];
    const theses = studentIds.length
      ? await this.thesisRepository.find({ where: { studentId: In(studentIds) } })
      : [];

    const studentsById = new Map(students.map((student) => [student.id, student]));
    const thesisByStudent = new Map(theses.map((thesis) => [thesis.studentId, thesis]));
    const thesisById = new Map(theses.map((thesis) => [thesis.id, thesis]));

    const submissions = theses.length
      ? await this.submissionRepository.find({
          where: {
            thesisId: In(theses.map((thesis) => thesis.id)),
            milestoneId: In(milestones.map((milestone) => milestone.id)),
            status: SubmissionStatus.COMPLETE,
          },
          order: { createdAt: 'DESC' },
        })
      : [];

    const submissionByMilestoneStudent = new Map<string, Submission>();
    for (const submission of submissions) {
      const thesis = thesisById.get(submission.thesisId);
      if (!thesis || !submission.milestoneId) {
        continue;
      }

      const key = `${submission.milestoneId}:${thesis.studentId}`;
      if (!submissionByMilestoneStudent.has(key)) {
        submissionByMilestoneStudent.set(key, submission);
      }
    }

    for (const milestone of milestones) {
      const rows = studentIds.map((studentId) => {
        const key = `${milestone.id}:${studentId}`;
        const submission = submissionByMilestoneStudent.get(key) ?? null;
        const student = studentsById.get(studentId);

        return {
          student_id: studentId,
          student_name: student?.fullName ?? 'Unknown Student',
          student_email: student?.email ?? null,
          completed: Boolean(submission),
          submission_id: submission?.id ?? null,
          submitted_at: submission?.createdAt?.toISOString() ?? null,
          thesis_id: thesisByStudent.get(studentId)?.id ?? null,
        };
      });

      const completed = rows.filter((row) => row.completed).length;
      result.set(milestone.id, {
        total_students: rows.length,
        completed_students: completed,
        pending_students: Math.max(0, rows.length - completed),
        students: rows,
      });
    }

    return result;
  }
}
