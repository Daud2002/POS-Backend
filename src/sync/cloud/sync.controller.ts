import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { StoreServer } from '../../entities';
import { CloudSyncService, FEED_LIMIT, PushBody } from './cloud-sync.service';
import { StoreServerAuthGuard } from './store-server-auth.guard';
import { StoreServersService } from './store-servers.service';

/** The endpoints a store server talks to. Authenticated by its credential, never by a user. */
@ApiExcludeController()
@Controller('sync')
@UseGuards(StoreServerAuthGuard)
export class SyncController {
  constructor(
    private readonly sync: CloudSyncService,
    private readonly servers: StoreServersService,
  ) {}

  @Get('bootstrap')
  async bootstrap(@Req() req: { storeServer: StoreServer }, @Res() res: Response) {
    await this.sync.bootstrap(req.storeServer, res);
  }

  @Get('pull')
  async pull(
    @Req() req: { storeServer: StoreServer },
    @Query('after') after = '0.0',
    @Query('deltaAfter') deltaAfter = '0.0',
    @Query('limit') limit?: string,
  ) {
    const size = Math.min(Math.max(Number(limit) || FEED_LIMIT, 1), FEED_LIMIT);
    return this.sync.pull(req.storeServer, after, deltaAfter, size);
  }

  @Post('push')
  @HttpCode(200)
  async push(@Req() req: { storeServer: StoreServer }, @Body() body: PushBody) {
    return this.sync.push(req.storeServer, body);
  }

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(
    @Req() req: { storeServer: StoreServer },
    @Body() body: { version?: string; lanUrls?: string[]; health?: Record<string, unknown> },
  ) {
    await this.servers.heartbeat(req.storeServer, body);
    return {
      serverTime: new Date().toISOString(),
      status: req.storeServer.status,
      store: await this.servers.writerStateOf(req.storeServer.storeId),
    };
  }
}
