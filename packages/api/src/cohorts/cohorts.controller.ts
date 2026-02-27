import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { CohortsService } from './cohorts.service';
import { CreateCohortDto } from './dto/create-cohort.dto';
import { EnrollStudentDto } from './dto/enroll-student.dto';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('cohorts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PROFESSOR)
export class CohortsController {
  constructor(private readonly cohortsService: CohortsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest): Promise<{ cohorts: Array<Record<string, unknown>> }> {
    return this.cohortsService.listForProfessor(req.user.id);
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCohortDto,
  ): Promise<{ cohort: Record<string, unknown> }> {
    return this.cohortsService.createForProfessor(req.user.id, dto);
  }

  @Get(':id/enrollments')
  listEnrollments(
    @Req() req: AuthenticatedRequest,
    @Param('id') cohortId: string,
  ): Promise<{ cohort: Record<string, unknown>; enrollments: Array<Record<string, unknown>> }> {
    return this.cohortsService.listEnrollmentsForProfessor(req.user.id, cohortId);
  }

  @Post(':id/enrollments')
  enroll(
    @Req() req: AuthenticatedRequest,
    @Param('id') cohortId: string,
    @Body() dto: EnrollStudentDto,
  ): Promise<{ enrollment: Record<string, unknown> }> {
    return this.cohortsService.enrollStudent(req.user.id, cohortId, dto.student_id);
  }
}
