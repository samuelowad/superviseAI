import { Module } from '@nestjs/common';

import { AzureOpenAiService } from './azure-openai.service';
import { AzureSpeechService } from './azure-speech.service';

@Module({
  providers: [AzureOpenAiService, AzureSpeechService],
  exports: [AzureOpenAiService, AzureSpeechService],
})
export class AzureModule {}
