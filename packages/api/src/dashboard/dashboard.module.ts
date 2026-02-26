import { Module } from '@nestjs/common';

import { ThesesModule } from '../theses/theses.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [ThesesModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
