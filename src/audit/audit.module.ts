import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog, RefreshToken } from '../entities';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditPurgeService } from './audit-purge.service';
import { AuditService } from './audit.service';

/**
 * Global so any service that needs to write an audit row by hand (the
 * impersonation exchange, which has no `req.user` yet) can inject
 * AuditService without importing anything. The interceptor is registered
 * here as APP_INTERCEPTOR, which Nest applies to every route regardless of
 * which module declared it.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, RefreshToken])],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditPurgeService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
