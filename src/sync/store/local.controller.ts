import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { StoreSyncService } from './store-sync.service';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Only the cashier PC itself may pair the server or poke the sync. Customers
 * share the shop's Wi-Fi; a phone on it must not be able to link this
 * server to some other store. (Trust proxy is off in store mode, so the
 * socket address cannot be spoofed with a header.)
 */
function assertLoopback(req: Request) {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) {
    throw new ForbiddenException('Open this on the store server PC itself (https://localhost).');
  }
}

@ApiExcludeController()
@Controller('local')
export class LocalController {
  constructor(private readonly sync: StoreSyncService) {}

  @Post('pair')
  @HttpCode(200)
  async pair(@Req() req: Request, @Body() body: { code: string; cloudUrl?: string }) {
    assertLoopback(req);
    return this.sync.pair(body.code, body.cloudUrl);
  }

  @Post('sync-now')
  @HttpCode(200)
  async syncNow(@Req() req: Request) {
    assertLoopback(req);
    await this.sync.syncNow();
    return this.sync.status();
  }

  /** Readable by any device on the Wi-Fi: counts and times only, nothing private. */
  @Get('status')
  async status() {
    return this.sync.status();
  }
}
