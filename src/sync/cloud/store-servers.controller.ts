import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { CurrentUser, Roles, RolesGuard, TenantService } from '@/common';
import { PairRequest, StoreServersService } from './store-servers.service';

/**
 * The owner's controls for their store's in-shop server, plus the two calls
 * that are not the owner's: `discover` (any member of staff, so their phone
 * can find the server) and `pair` (the new server itself, holding a code).
 */
@ApiTags('Store servers')
@Controller('store-servers')
export class StoreServersController {
  constructor(
    private readonly servers: StoreServersService,
    private readonly tenant: TenantService,
  ) {}

  /** A platform admin names the store; an owner always acts on their own. */
  private async storeOf(user: any, storeId?: string) {
    const own = await this.tenant.resolveStoreId(user);
    if (own) return own;
    if (!storeId) throw new BadRequestException('storeId is required');
    return storeId;
  }

  @Post('pairing-codes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('restaurant_owner', 'store_owner', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'One-time code to link a new store server to this store (valid 10 minutes)' })
  async createPairingCode(@CurrentUser() user: any, @Query('storeId') storeId?: string) {
    return this.servers.createPairingCode(await this.storeOf(user, storeId), user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('restaurant_owner', 'store_owner', 'super_admin')
  @ApiBearerAuth()
  async list(@CurrentUser() user: any, @Query('storeId') storeId?: string) {
    return this.servers.list(await this.storeOf(user, storeId));
  }

  @Get('discover')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Where this store's in-shop server can be reached, if it has one" })
  async discover(@CurrentUser() user: any) {
    return this.servers.discover(await this.tenant.requireStoreId(user));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('restaurant_owner', 'store_owner', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Make this server the place orders are taken' })
  async activate(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Query('storeId') storeId?: string) {
    return this.servers.activate(await this.storeOf(user, storeId), id);
  }

  @Post(':id/failover')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('restaurant_owner', 'store_owner', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Take orders through the cloud again (the shop PC is down)' })
  async failover(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Query('storeId') storeId?: string) {
    return this.servers.failover(await this.storeOf(user, storeId), id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('restaurant_owner', 'store_owner', 'super_admin')
  @ApiBearerAuth()
  async revoke(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Query('storeId') storeId?: string) {
    return this.servers.revoke(await this.storeOf(user, storeId), id);
  }

  @Post('pair')
  @HttpCode(200)
  @ApiOperation({ summary: 'Called by a new store server with the pairing code' })
  async pair(@Body() body: PairRequest) {
    return this.servers.pair(body);
  }
}
