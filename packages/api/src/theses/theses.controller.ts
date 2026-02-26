import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { CreateThesisDto } from './dto/create-thesis.dto';
import { ThesesService } from './theses.service';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('theses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class ThesesController {
  constructor(private readonly thesesService: ThesesService) {}

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateThesisDto,
  ): Promise<{ thesis: unknown }> {
    return this.thesesService.create(req.user.id, dto);
  }

  @Get('me/workspace')
  workspace(@Req() req: AuthenticatedRequest): Promise<Record<string, unknown>> {
    return this.thesesService.getWorkspace(req.user.id);
  }

  @Get('professors/search')
  searchProfessors(
    @Query('q') query: string,
  ): Promise<{ professors: Array<Record<string, string>> }> {
    return this.thesesService.searchProfessors(query ?? '');
  }

  @Patch(':id/send-to-supervisor')
  sendToSupervisor(
    @Req() req: AuthenticatedRequest,
    @Param('id') thesisId: string,
  ): Promise<{ status: string }> {
    return this.thesesService.sendToSupervisor(req.user.id, thesisId);
  }
}
