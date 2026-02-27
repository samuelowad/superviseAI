import { Module } from '@nestjs/common';

import { SemanticScholarService } from './semanticscholar.service';

@Module({
  providers: [SemanticScholarService],
  exports: [SemanticScholarService],
})
export class SemanticScholarModule {}
