import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('submissions')
@UseGuards(JwtAuthGuard)
export class SubmissionsController {
  @Get()
  list(): { route: string; status: string } {
    return { route: 'submissions', status: 'stub_ready_phase_0' };
  }
}
