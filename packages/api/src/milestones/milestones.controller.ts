import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { MilestonesService } from './milestones.service';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('milestones')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PROFESSOR)
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest): Promise<{ milestones: Array<Record<string, unknown>> }> {
    return this.milestonesService.listForProfessor(req.user.id);
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMilestoneDto,
  ): Promise<{ milestone: Record<string, unknown> }> {
    return this.milestonesService.createForProfessor(req.user.id, dto);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ): Promise<{ milestone: Record<string, unknown> }> {
    return this.milestonesService.updateForProfessor(req.user.id, milestoneId, dto);
  }
}
