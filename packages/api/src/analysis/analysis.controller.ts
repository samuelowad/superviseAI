import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('analysis')
@UseGuards(JwtAuthGuard)
export class AnalysisController {
  @Get('status')
  status(): { route: string; status: string } {
    return { route: 'analysis', status: 'stub_ready_phase_0' };
  }
}
