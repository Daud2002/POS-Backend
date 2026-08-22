import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { CreateStoreDto, UpdateStoreDto } from './dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Roles, RolesGuard, CurrentUser, TenantService, parsePaging, wantsCount } from '@/common';

@ApiTags('Stores')
@Controller('stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class StoresController {
  constructor(
    private storesService: StoresService,
    private tenantService: TenantService,
  ) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Get all stores (platform admin only)' })
  @ApiResponse({ status: 200, description: 'List of stores' })
  async getAllStores(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const paging = parsePaging(skip, take, 10);
    if (wantsCount(withCount)) {
      return this.storesService.findAllPaged(paging.skip, paging.take);
    }
    return this.storesService.findAll(paging.skip, paging.take);
  }

  /**
   * Left open to any authenticated user because both clients read their own
   * store here for receipt headers (currency, address, printer). Scoped below
   * so a user cannot read another tenant's store.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get store by ID (own store, or any for platform admin)' })
  @ApiResponse({ status: 200, description: 'Store details' })
  @ApiResponse({ status: 403, description: 'Not your store' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async getStore(@Param('id') id: string, @CurrentUser() user: any) {
    const storeId = await this.tenantService.resolveStoreId(user);
    // `undefined` means platform admin, which is intentionally unscoped.
    if (storeId && storeId !== id) {
      throw new ForbiddenException('You do not have access to this store');
    }
    return this.storesService.findOne(id);
  }

  @Post()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Create a store and its owner account (platform admin only)' })
  @ApiResponse({ status: 201, description: 'Store created successfully' })
  async createStore(@Body() createStoreDto: CreateStoreDto) {
    return this.storesService.create(createStoreDto);
  }

  @Patch(':id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Update store (platform admin only)' })
  @ApiResponse({ status: 200, description: 'Store updated successfully' })
  async updateStore(
    @Param('id') id: string,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    return this.storesService.update(id, updateStoreDto);
  }

  @Delete(':id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Delete store and its owner (platform admin only)' })
  @ApiResponse({ status: 200, description: 'Store deleted successfully' })
  async deleteStore(@Param('id') id: string) {
    return this.storesService.delete(id);
  }
}
