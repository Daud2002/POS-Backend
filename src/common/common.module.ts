import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Store, Employee } from '../entities';
import { TenantService } from './tenant.service';
import { RolesGuard } from './roles.guard';

/**
 * Global so every feature module can inject TenantService without repeating
 * the Store/Employee repository imports.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Store, Employee])],
  providers: [TenantService, RolesGuard],
  exports: [TenantService, RolesGuard],
})
export class CommonModule {}
