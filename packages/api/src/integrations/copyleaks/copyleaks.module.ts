import { Module } from '@nestjs/common';

import { CopyleaksService } from './copyleaks.service';

@Module({
  providers: [CopyleaksService],
  exports: [CopyleaksService],
})
export class CopyleaksModule {}
