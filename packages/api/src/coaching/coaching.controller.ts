import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

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

  /**
   * POST /coaching/voice
   * Accept an audio file (WAV/WebM/MP3), transcribe via Azure STT,
   * process as a coaching message, and return the AI response.
   * Query param: session_id (required)
   */
  @Post('voice')
  @UseInterceptors(FileInterceptor('audio'))
  async voice(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
    @Query('session_id') sessionId: string,
  ): Promise<Record<string, unknown>> {
    if (!file?.buffer) {
      throw new BadRequestException('No audio file provided.');
    }
    if (!sessionId) {
      throw new BadRequestException('session_id query parameter is required.');
    }

    return this.coachingService.voice(
      req.user.id,
      file.buffer,
      sessionId,
      file.mimetype ?? 'audio/wav',
    );
  }

  /**
   * POST /coaching/tts
   * Convert text to speech via Azure TTS, return audio/mpeg stream.
   * Body: { text: string }
   */
  @Post('tts')
  async tts(@Body() body: { text?: string }, @Res() res: Response): Promise<void> {
    if (!body.text) {
      res.status(400).json({ error: { code: 'MISSING_TEXT', message: 'text field required' } });
      return;
    }

    const audioBuffer = await this.coachingService.tts(body.text);
    if (!audioBuffer) {
      res
        .status(503)
        .json({ error: { code: 'TTS_UNAVAILABLE', message: 'Text-to-speech is not available.' } });
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  }

  @Get('thesis/:thesisId/latest')
  latestByThesis(
    @Req() req: AuthenticatedRequest,
    @Param('thesisId') thesisId: string,
  ): Promise<Record<string, unknown>> {
    return this.coachingService.latestByThesis(req.user.id, thesisId);
  }
}
