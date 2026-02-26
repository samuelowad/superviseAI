import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Thesis } from '../theses/entities/thesis.entity';
import { CoachingSession } from './entities/coaching-session.entity';
import { CoachingController } from './coaching.controller';
import { CoachingService } from './coaching.service';

@Module({
  imports: [TypeOrmModule.forFeature([Thesis, CoachingSession])],
  controllers: [CoachingController],
  providers: [CoachingService],
})
export class CoachingModule {}
