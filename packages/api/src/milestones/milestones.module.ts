import { Module } from '@nestjs/common';

import { MilestonesController } from './milestones.controller';

@Module({
  controllers: [MilestonesController],
})
export class MilestonesModule {}
