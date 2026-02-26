import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ThesesService } from '../theses/theses.service';
import { UserRole } from '../users/user.entity';
import { ProfessorReviewDto } from './dto/professor-review.dto';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly thesesService: ThesesService) {}

  @Get('professor')
  @Roles(UserRole.PROFESSOR)
  professorDashboard(@Req() req: AuthenticatedRequest): Promise<Record<string, unknown>> {
    return this.thesesService.getProfessorDashboard(req.user.id);
  }

  @Get('professor/students')
  @Roles(UserRole.PROFESSOR)
  professorStudents(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ students: Array<Record<string, unknown>> }> {
    return this.thesesService.getProfessorStudents(req.user.id);
  }

  @Get('professor/students/:thesisId')
  @Roles(UserRole.PROFESSOR)
  professorStudentDetail(
    @Req() req: AuthenticatedRequest,
    @Param('thesisId') thesisId: string,
  ): Promise<Record<string, unknown>> {
    return this.thesesService.getProfessorStudentDetail(req.user.id, thesisId);
  }

  @Patch('professor/students/:thesisId/review')
  @Roles(UserRole.PROFESSOR)
  submitProfessorReview(
    @Req() req: AuthenticatedRequest,
    @Param('thesisId') thesisId: string,
    @Body() dto: ProfessorReviewDto,
  ): Promise<Record<string, unknown>> {
    return this.thesesService.submitProfessorReview(req.user.id, thesisId, dto);
  }

  @Get('professor/analytics')
  @Roles(UserRole.PROFESSOR)
  professorAnalytics(@Req() req: AuthenticatedRequest): Promise<Record<string, unknown>> {
    return this.thesesService.getProfessorAnalytics(req.user.id);
  }
}
