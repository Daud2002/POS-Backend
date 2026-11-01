import { Controller, Get, Optional } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { deploymentMode } from '../config/deployment';
import { StoreSyncService } from './store/store-sync.service';

/**
 * Who answers at this address. Apps call it to tell a store server from the
 * cloud and to check that a server on the Wi-Fi is THEIR store's before
 * sending it anyone's password.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@Optional() private readonly storeSync?: StoreSyncService) {}

  @Get()
  async health() {
    const mode = deploymentMode();
    if (mode === 'cloud' || !this.storeSync) return { app: 'tapntrade-cloud', mode };

    const status = await this.storeSync.status();
    return {
      app: 'tapntrade-store',
      mode,
      serverId: status.serverId,
      storeId: status.storeId,
      writable: status.writable,
      caSha256: process.env.TNT_CA_SHA256 ?? null,
      cloud: { reachable: status.cloudReachable, lastSyncAt: status.lastSyncAt },
    };
  }
}
