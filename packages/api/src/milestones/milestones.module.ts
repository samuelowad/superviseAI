import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Cohort } from '../cohorts/entities/cohort.entity';
import { Enrollment } from '../cohorts/entities/enrollment.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Thesis } from '../theses/entities/thesis.entity';
import { User } from '../users/user.entity';
import { Milestone } from './entities/milestone.entity';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';

@Module({
  imports: [TypeOrmModule.forFeature([Milestone, Cohort, Enrollment, Thesis, Submission, User])],
  controllers: [MilestonesController],
  providers: [MilestonesService],
})
export class MilestonesModule {}
