import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { CoachingService } from './coaching.service';
import { EndSessionDto } from './dto/end-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartCoachingDto } from './dto/start-coaching.dto';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('coaching')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class CoachingController {
  constructor(private readonly coachingService: CoachingService) {}

  @Post('start')
  start(
    @Req() req: AuthenticatedRequest,
    @Body() dto: StartCoachingDto,
  ): Promise<Record<string, unknown>> {
    return this.coachingService.start(req.user.id, dto);
  }

  @Post('message')
  message(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendMessageDto,
  ): Promise<Record<string, unknown>> {
    return this.coachingService.message(req.user.id, dto);
  }

  @Post('end')
  end(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EndSessionDto,
  ): Promise<Record<string, unknown>> {
    return this.coachingService.end(req.user.id, dto);
  }

  @Get('thesis/:thesisId/latest')
  latestByThesis(
    @Req() req: AuthenticatedRequest,
    @Param('thesisId') thesisId: string,
  ): Promise<Record<string, unknown>> {
    return this.coachingService.latestByThesis(req.user.id, thesisId);
  }
}
