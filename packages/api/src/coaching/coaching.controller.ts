import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('coaching')
@UseGuards(JwtAuthGuard)
export class CoachingController {
  @Get('status')
  status(): { route: string; status: string } {
    return { route: 'coaching', status: 'stub_ready_phase_0' };
  }
}
