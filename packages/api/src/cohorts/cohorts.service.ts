import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Thesis } from '../theses/entities/thesis.entity';
import { User, UserRole } from '../users/user.entity';
import { CreateCohortDto } from './dto/create-cohort.dto';
import { Cohort } from './entities/cohort.entity';
import { Enrollment } from './entities/enrollment.entity';

@Injectable()
export class CohortsService {
  constructor(
    @InjectRepository(Cohort)
    private readonly cohortRepository: Repository<Cohort>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Thesis)
    private readonly thesisRepository: Repository<Thesis>,
  ) {}

  async listForProfessor(
    professorId: string,
  ): Promise<{ cohorts: Array<Record<string, unknown>> }> {
    const cohorts = await this.cohortRepository.find({
      where: { professorId },
      order: { createdAt: 'ASC' },
    });

    if (cohorts.length === 0) {
      return { cohorts: [] };
    }

    const cohortIds = cohorts.map((cohort) => cohort.id);
    const enrollments = await this.enrollmentRepository.find({
      where: { cohortId: In(cohortIds) },
    });

    const counts = new Map<string, number>();
    for (const enrollment of enrollments) {
      counts.set(enrollment.cohortId, (counts.get(enrollment.cohortId) ?? 0) + 1);
    }

    return {
      cohorts: cohorts.map((cohort) => ({
        id: cohort.id,
        name: cohort.name,
        citation_style: cohort.citationStyle,
        student_count: counts.get(cohort.id) ?? 0,
        created_at: cohort.createdAt,
      })),
    };
  }

  async createForProfessor(
    professorId: string,
    dto: CreateCohortDto,
  ): Promise<{ cohort: Record<string, unknown> }> {
    const name = dto.name.trim();
    const existing = await this.cohortRepository.findOne({
      where: { professorId, name },
    });
    if (existing) {
      throw new BadRequestException('A cohort with this name already exists.');
    }

    const cohort = this.cohortRepository.create({
      professorId,
      name,
      citationStyle: dto.citation_style?.trim() || 'APA',
    });

    const saved = await this.cohortRepository.save(cohort);
    return {
      cohort: {
        id: saved.id,
        name: saved.name,
        citation_style: saved.citationStyle,
        created_at: saved.createdAt,
      },
    };
  }

  async listEnrollmentsForProfessor(
    professorId: string,
    cohortId: string,
  ): Promise<{ cohort: Record<string, unknown>; enrollments: Array<Record<string, unknown>> }> {
    const cohort = await this.cohortRepository.findOne({ where: { id: cohortId, professorId } });
    if (!cohort) {
      throw new NotFoundException('Cohort not found for this professor.');
    }

    const enrollments = await this.enrollmentRepository.find({
      where: { cohortId: cohort.id },
      order: { enrolledAt: 'ASC' },
    });

    const students = enrollments.length
      ? await this.userRepository.find({
          where: { id: In(enrollments.map((row) => row.studentId)) },
        })
      : [];
    const studentsById = new Map(students.map((student) => [student.id, student]));

    return {
      cohort: {
        id: cohort.id,
        name: cohort.name,
        citation_style: cohort.citationStyle,
      },
      enrollments: enrollments.map((enrollment) => ({
        id: enrollment.id,
        student_id: enrollment.studentId,
        student_name: studentsById.get(enrollment.studentId)?.fullName ?? 'Unknown Student',
        student_email: studentsById.get(enrollment.studentId)?.email ?? null,
        enrolled_at: enrollment.enrolledAt,
      })),
    };
  }

  async enrollStudent(
    professorId: string,
    cohortId: string,
    studentId: string,
  ): Promise<{ enrollment: Record<string, unknown> }> {
    const cohort = await this.cohortRepository.findOne({ where: { id: cohortId, professorId } });
    if (!cohort) {
      throw new NotFoundException('Cohort not found for this professor.');
    }

    const student = await this.userRepository.findOne({ where: { id: studentId } });
    if (!student || student.role !== UserRole.STUDENT) {
      throw new BadRequestException('Student not found.');
    }

    const enrollment = await this.ensureEnrollment(cohort.id, student.id);
    return {
      enrollment: {
        id: enrollment.id,
        cohort_id: enrollment.cohortId,
        student_id: enrollment.studentId,
        student_name: student.fullName,
        student_email: student.email,
        enrolled_at: enrollment.enrolledAt,
      },
    };
  }

  async ensureDefaultCohortForProfessor(professorId: string): Promise<Cohort> {
    const existing = await this.cohortRepository.findOne({
      where: { professorId, name: 'Default Cohort' },
    });
    if (existing) {
      return existing;
    }

    const created = this.cohortRepository.create({
      professorId,
      name: 'Default Cohort',
      citationStyle: 'APA',
    });
    return this.cohortRepository.save(created);
  }

  async ensureEnrollment(cohortId: string, studentId: string): Promise<Enrollment> {
    const existing = await this.enrollmentRepository.findOne({
      where: { cohortId, studentId },
    });
    if (existing) {
      return existing;
    }

    const enrollment = this.enrollmentRepository.create({
      cohortId,
      studentId,
    });
    return this.enrollmentRepository.save(enrollment);
  }

  async ensureEnrollmentInProfessorDefaultCohort(
    professorId: string,
    studentId: string,
  ): Promise<Enrollment> {
    const cohort = await this.ensureDefaultCohortForProfessor(professorId);
    return this.ensureEnrollment(cohort.id, studentId);
  }

  async getProfessorScopedCohortIds(professorId: string): Promise<string[]> {
    const cohorts = await this.cohortRepository.find({
      where: { professorId },
      select: { id: true },
    });
    return cohorts.map((cohort) => cohort.id);
  }

  async getProfessorScopedStudentIds(professorId: string): Promise<string[]> {
    const cohortIds = await this.getProfessorScopedCohortIds(professorId);
    if (cohortIds.length === 0) {
      return [];
    }

    const enrollments = await this.enrollmentRepository.find({
      where: { cohortId: In(cohortIds) },
      select: { studentId: true },
    });

    return [...new Set(enrollments.map((enrollment) => enrollment.studentId))];
  }

  async getProfessorIdsForStudent(studentId: string): Promise<string[]> {
    const rows = await this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .innerJoin(Cohort, 'cohort', 'cohort.id = enrollment.cohort_id')
      .select('cohort.professor_id', 'professor_id')
      .where('enrollment.student_id = :studentId', { studentId })
      .getRawMany<{ professor_id: string }>();

    return [...new Set(rows.map((row) => row.professor_id).filter(Boolean))];
  }

  async getStudentCohortIds(studentId: string): Promise<string[]> {
    const enrollments = await this.enrollmentRepository.find({
      where: { studentId },
      select: { cohortId: true },
      order: { enrolledAt: 'ASC' },
    });

    return [...new Set(enrollments.map((enrollment) => enrollment.cohortId))];
  }

  async getStudentCohortIdsForProfessor(studentId: string, professorId: string): Promise<string[]> {
    const rows = await this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .innerJoin(Cohort, 'cohort', 'cohort.id = enrollment.cohort_id')
      .select('enrollment.cohort_id', 'cohort_id')
      .where('enrollment.student_id = :studentId', { studentId })
      .andWhere('cohort.professor_id = :professorId', { professorId })
      .orderBy('enrollment.enrolled_at', 'ASC')
      .getRawMany<{ cohort_id: string }>();

    return [...new Set(rows.map((row) => row.cohort_id).filter(Boolean))];
  }

  async isStudentInProfessorScope(professorId: string, studentId: string): Promise<boolean> {
    const cohortIds = await this.getProfessorScopedCohortIds(professorId);
    if (cohortIds.length === 0) {
      return false;
    }

    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId, cohortId: In(cohortIds) },
    });

    return Boolean(enrollment);
  }

  async isStudentEnrolledInCohort(studentId: string, cohortId: string): Promise<boolean> {
    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId, cohortId },
    });

    return Boolean(enrollment);
  }

  async getCohortForProfessor(professorId: string, cohortId: string): Promise<Cohort> {
    const cohort = await this.cohortRepository.findOne({ where: { id: cohortId, professorId } });
    if (!cohort) {
      throw new NotFoundException('Cohort not found for this professor.');
    }

    return cohort;
  }

  async getCohortById(cohortId: string): Promise<Cohort | null> {
    return this.cohortRepository.findOne({ where: { id: cohortId } });
  }

  async ensureEnrollmentForThesis(thesisId: string): Promise<void> {
    const thesis = await this.thesisRepository.findOne({ where: { id: thesisId } });
    if (!thesis?.supervisorId) {
      return;
    }

    await this.ensureEnrollmentInProfessorDefaultCohort(thesis.supervisorId, thesis.studentId);
  }
}
