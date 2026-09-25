import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import {
  CurrentUser,
  RequirePermissions,
  PermissionsGuard,
  TenantService,
  parsePaging,
  wantsCount,
} from '@/common';
import { InventoryService } from './inventory.service';
import {
  AdjustStockDto,
  CreateInventoryItemDto,
  SetRecipeDto,
  StockInDto,
  UpdateInventoryItemDto,
} from './dto';

/**
 * A restaurant's ingredient stock (ml, g, bottles) and the recipes that
 * consume it when an order is settled.
 *
 * Restaurant-only: a general store tracks whole-unit product stock through
 * /products instead. Recipes are edited from the product form, so they are
 * open to whoever may edit products as well as to the inventory module —
 * and so is the ingredient LIST, which the recipe picker needs.
 */
@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(
    private inventoryService: InventoryService,
    private tenantService: TenantService,
  ) {}

  private async storeId(user: any): Promise<string> {
    return (await this.tenantService.requireRestaurantStore(user)).id;
  }

  // ----------------------------------------------------------- recipes
  // Declared before the ':id' routes: Nest matches in declaration order.

  @Get('recipes/:productId')
  @RequirePermissions('inventory', 'products')
  @ApiOperation({ summary: "A product's recipe" })
  async getRecipe(@CurrentUser() user: any, @Param('productId') productId: string) {
    return this.inventoryService.getRecipe(productId, await this.storeId(user));
  }

  @Put('recipes/:productId')
  @RequirePermissions('inventory', 'products')
  @ApiOperation({ summary: "Replace a product's recipe" })
  async setRecipe(
    @CurrentUser() user: any,
    @Param('productId') productId: string,
    @Body() dto: SetRecipeDto,
  ) {
    return this.inventoryService.setRecipe(productId, await this.storeId(user), dto);
  }

  // ------------------------------------------------------------- items

  @Get()
  @RequirePermissions('inventory', 'products')
  @ApiOperation({ summary: 'List inventory items' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  async list(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const storeId = await this.storeId(user);
    const filters = { search, includeInactive: includeInactive === 'true' };
    if (wantsCount(withCount)) {
      const paging = parsePaging(skip, take);
      return this.inventoryService.findAllPaged(storeId, paging.skip, paging.take, filters);
    }
    return this.inventoryService.findAll(storeId, filters);
  }

  @Get(':id')
  @RequirePermissions('inventory')
  @ApiOperation({ summary: 'Get one inventory item' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.inventoryService.findOne(id, await this.storeId(user));
  }

  @Get(':id/movements')
  @RequirePermissions('inventory')
  @ApiOperation({ summary: "An item's stock history, newest first" })
  async movements(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const paging = parsePaging(skip, take);
    return this.inventoryService.movements(id, await this.storeId(user), paging.skip, paging.take);
  }

  @Post()
  @RequirePermissions('inventory')
  @ApiOperation({ summary: 'Add an inventory item' })
  @ApiResponse({ status: 409, description: 'An item with that name already exists' })
  async create(@CurrentUser() user: any, @Body() dto: CreateInventoryItemDto) {
    return this.inventoryService.create(await this.storeId(user), dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('inventory')
  @ApiOperation({ summary: 'Rename, re-threshold or retire an inventory item' })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.inventoryService.update(id, await this.storeId(user), dto);
  }

  @Post(':id/stock-in')
  @RequirePermissions('inventory')
  @ApiOperation({ summary: 'Record stock arriving (bottles may be entered in sets)' })
  async stockIn(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: StockInDto) {
    return this.inventoryService.stockIn(id, await this.storeId(user), dto, user.id);
  }

  @Post(':id/adjust')
  @RequirePermissions('inventory')
  @ApiOperation({ summary: 'Set the counted quantity on hand' })
  async adjust(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: AdjustStockDto) {
    return this.inventoryService.adjust(id, await this.storeId(user), dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('inventory')
  @ApiOperation({ summary: 'Delete an inventory item that no recipe uses' })
  @ApiResponse({ status: 409, description: 'Still used by a recipe' })
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.inventoryService.remove(id, await this.storeId(user));
  }
}
