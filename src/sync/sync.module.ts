import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Store, StorePairingCode, StoreServer } from '../entities';
import { deploymentMode } from '../config/deployment';
import { ApplyService } from './shared/apply.service';
import { HealthController } from './health.controller';
import { CloudSyncService } from './cloud/cloud-sync.service';
import { StoreServerAuthGuard } from './cloud/store-server-auth.guard';
import { StoreServersController } from './cloud/store-servers.controller';
import { StoreServersService } from './cloud/store-servers.service';
import { SyncController } from './cloud/sync.controller';
import { LocalController } from './store/local.controller';
import { StoreSyncService } from './store/store-sync.service';

/**
 * Cloud ⇄ store server sync. The cloud gets the pairing and sync endpoints;
 * a store server gets the worker that talks to them and its local controls.
 *
 * `register()` reads DEPLOYMENT_MODE while AppModule's imports are built,
 * which is after ConfigModule.forRoot() (earlier in the same array) loaded .env.
 */
@Module({})
export class SyncModule {
  static register(mode = deploymentMode()): DynamicModule {
    const shared = [ApplyService];
    if (mode === 'store') {
      return {
        module: SyncModule,
        imports: [TypeOrmModule.forFeature([Store])],
        controllers: [HealthController, LocalController],
        providers: [...shared, StoreSyncService],
        exports: [StoreSyncService],
      };
    }
    return {
      module: SyncModule,
      imports: [TypeOrmModule.forFeature([Store, StoreServer, StorePairingCode])],
      controllers: [HealthController, StoreServersController, SyncController],
      providers: [...shared, StoreServersService, CloudSyncService, StoreServerAuthGuard],
      exports: [StoreServersService],
    };
  }
}
