import { Controller, Get, UseGuards } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  @Get('professor')
  @Roles(UserRole.PROFESSOR)
  professorDashboard(): { route: string; status: string } {
    return { route: 'dashboard/professor', status: 'stub_ready_phase_0' };
  }
}
