import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Isolated so a gateway failure cannot take down the REST API — the deploy
 * runs a single pm2 fork, so an unhandled error at bootstrap would stop the
 * whole service.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
