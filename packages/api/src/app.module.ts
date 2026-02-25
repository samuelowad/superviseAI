import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AnalysisModule } from './analysis/analysis.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CoachingModule } from './coaching/coaching.module';
import { RolesGuard } from './common/guards/roles.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { DashboardModule } from './dashboard/dashboard.module';
import { MailModule } from './mail/mail.module';
import { MilestonesModule } from './milestones/milestones.module';
import { StorageModule } from './storage/storage.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV !== 'production',
    }),
    UsersModule,
    AuthModule,
    MailModule,
    StorageModule,
    SubmissionsModule,
    AnalysisModule,
    CoachingModule,
    MilestonesModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [JwtAuthGuard, RolesGuard],
})
export class AppModule {}
