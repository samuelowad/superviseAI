import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('milestones')
@UseGuards(JwtAuthGuard)
export class MilestonesController {
  @Get()
  list(): { route: string; status: string } {
    return { route: 'milestones', status: 'stub_ready_phase_0' };
  }
}
