import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Thesis } from '../theses/entities/thesis.entity';
import { User } from '../users/user.entity';
import { CohortsController } from './cohorts.controller';
import { CohortsService } from './cohorts.service';
import { Cohort } from './entities/cohort.entity';
import { Enrollment } from './entities/enrollment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Cohort, Enrollment, User, Thesis])],
  controllers: [CohortsController],
  providers: [CohortsService],
  exports: [CohortsService, TypeOrmModule],
})
export class CohortsModule {}
