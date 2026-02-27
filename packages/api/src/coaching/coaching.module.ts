import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AzureModule } from '../integrations/azure/azure.module';
import { Submission } from '../submissions/entities/submission.entity';
import { Thesis } from '../theses/entities/thesis.entity';
import { CoachingSession } from './entities/coaching-session.entity';
import { CoachingController } from './coaching.controller';
import { CoachingService } from './coaching.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Thesis, Submission, CoachingSession]),
    AzureModule,
    MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }), // 10 MB audio max
  ],
  controllers: [CoachingController],
  providers: [CoachingService],
})
export class CoachingModule {}
