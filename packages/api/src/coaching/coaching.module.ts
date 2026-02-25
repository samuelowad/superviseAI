import { Module } from '@nestjs/common';

import { CoachingController } from './coaching.controller';

@Module({
  controllers: [CoachingController],
})
export class CoachingModule {}
