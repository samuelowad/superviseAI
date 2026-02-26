import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { SubmissionsService } from './submissions.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@Controller('submissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('upload')
  @Roles(UserRole.STUDENT)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<{ submission_id: string; status: string }> {
    if (!file?.buffer) {
      throw new BadRequestException('File is required.');
    }

    return this.submissionsService.upload(req.user.id, file);
  }

  @Get(':id/file')
  @Roles(UserRole.STUDENT, UserRole.PROFESSOR)
  async streamFile(
    @Req() req: AuthenticatedRequest,
    @Param('id') submissionId: string,
  ): Promise<StreamableFile> {
    const isProfessor = req.user.role === UserRole.PROFESSOR;
    const { buffer, contentType, filename } = isProfessor
      ? await this.submissionsService.streamFileForProfessor(req.user.id, submissionId)
      : await this.submissionsService.streamFile(req.user.id, submissionId);

    return new StreamableFile(buffer, {
      type: contentType,
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Get(':id')
  @Roles(UserRole.STUDENT)
  getOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') submissionId: string,
  ): Promise<Record<string, unknown>> {
    return this.submissionsService.getOne(req.user.id, submissionId);
  }
}
