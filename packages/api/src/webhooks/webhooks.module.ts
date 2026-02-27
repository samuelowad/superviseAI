import { Module } from '@nestjs/common';

import { SubmissionsModule } from '../submissions/submissions.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [SubmissionsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
