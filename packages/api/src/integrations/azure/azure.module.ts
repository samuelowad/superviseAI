import { Module } from '@nestjs/common';

import { AzureCognitiveService } from './azure-cognitive.service';
import { AzureOpenAiService } from './azure-openai.service';
import { AzureSpeechService } from './azure-speech.service';

@Module({
  providers: [AzureOpenAiService, AzureSpeechService, AzureCognitiveService],
  exports: [AzureOpenAiService, AzureSpeechService, AzureCognitiveService],
})
export class AzureModule {}
