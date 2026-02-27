import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
