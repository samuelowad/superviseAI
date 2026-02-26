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
  user: { id: string };
}

@Controller('submissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('upload')
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
  async streamFile(
    @Req() req: AuthenticatedRequest,
    @Param('id') submissionId: string,
  ): Promise<StreamableFile> {
    const { buffer, contentType, filename } = await this.submissionsService.streamFile(
      req.user.id,
      submissionId,
    );

    return new StreamableFile(buffer, {
      type: contentType,
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Get(':id')
  getOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') submissionId: string,
  ): Promise<Record<string, unknown>> {
    return this.submissionsService.getOne(req.user.id, submissionId);
  }
}
