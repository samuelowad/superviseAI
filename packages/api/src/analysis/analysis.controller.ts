import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { AnalysisService } from './analysis.service';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('analysis')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get('full/:submissionId')
  getFull(
    @Req() req: AuthenticatedRequest,
    @Param('submissionId') submissionId: string,
  ): Promise<Record<string, unknown>> {
    return this.analysisService.getFullAnalysis(req.user.id, submissionId);
  }
}
