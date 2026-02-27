import { Body, Controller, HttpCode, Logger, Param, Post } from '@nestjs/common';

import { SubmissionsService } from '../submissions/submissions.service';

/**
 * Webhook endpoint for Copyleaks async scan results.
 * URL pattern: POST /api/v1/webhooks/copyleaks/:status/:submissionId
 *
 * No auth guard — Copyleaks calls this from their servers.
 * The submissionId in the URL is validated by SubmissionsService.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('copyleaks/:status/:submissionId')
  @HttpCode(200)
  async copyleaksWebhook(
    @Param('status') status: string,
    @Param('submissionId') submissionId: string,
    @Body() payload: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    this.logger.log(`Copyleaks webhook [${status}] for submission: ${submissionId}`);

    if (status === 'completed' || status === 'success') {
      await this.submissionsService.handleCopyleaksWebhook(submissionId, payload);
    } else {
      this.logger.warn(`Copyleaks webhook non-success status: ${status} for ${submissionId}`);
    }

    return { ok: true };
  }
}
