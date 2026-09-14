import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  CurrentUser,
  PermissionsGuard,
  RequirePermissions,
  RolesGuard,
  TenantService,
  parsePaging,
  parseOptionalPaging,
  wantsCount,
} from '@/common';

/**
 * A restaurant's customer book is a delivery book: name, phone, address.
 * Email and city belong to the general-store contact card only, so on a
 * restaurant tenant they are dropped before the service sees them — whatever
 * an older client still sends.
 */
function forTenant<T extends { email?: string; city?: string }>(user: any, dto: T): T {
  if (user?.accountType !== 'restaurant') return dto;
  const { email: _email, city: _city, ...rest } = dto;
  return rest as T;
}

/**
 * The store's customers.
 *
 * Reads that the till needs while taking an order (the list, live
 * suggestions) are open to anyone who works a till — `pos` on a general
 * store, `cashier` on a restaurant — as well as to whoever holds the
 * `customers` module. Managing the directory (editing, deleting, viewing a
 * customer's history) is the `customers` module alone.
 *
 * Every route resolves the store from the caller, never from the request.
 */
@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly tenantService: TenantService,
  ) {}

  @Post()
  @RequirePermissions('customers', 'pos')
  @ApiOperation({ summary: 'Create a new customer' })
  @ApiResponse({ status: 409, description: 'A customer with that phone already exists' })
  async create(@CurrentUser() user: any, @Body() createCustomerDto: CreateCustomerDto) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.customersService.create(storeId, forTenant(user, createCustomerDto));
  }

  @Get()
  @RequirePermissions('customers', 'pos')
  @ApiOperation({ summary: 'Get all customers' })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
    @Query('search') search?: string,
  ) {
    const storeId = await this.tenantService.requireStoreId(user);
    if (wantsCount(withCount)) {
      const paging = parsePaging(skip, take);
      return this.customersService.findAllPaged(storeId, paging.skip, paging.take, search);
    }
    const paging = parseOptionalPaging(skip, take);
    return this.customersService.findAll(storeId, paging.skip, paging.take);
  }

  // Declared BEFORE ':id': Nest matches in declaration order, so 'suggest'
  // would otherwise be captured as a customer id.
  @Get('suggest')
  @RequirePermissions('customers', 'pos', 'cashier')
  @ApiOperation({ summary: 'Live matches on name, phone or address for the order screen' })
  @ApiQuery({ name: 'q', required: true, description: 'At least two characters' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default 8, max 20' })
  async suggest(
    @CurrentUser() user: any,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const storeId = await this.tenantService.requireStoreId(user);
    const cap = Number(limit);
    return this.customersService.suggest(storeId, q ?? '', Number.isFinite(cap) ? cap : 8);
  }

  @Get(':id')
  @RequirePermissions('customers')
  @ApiOperation({ summary: 'Get customer by ID' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.customersService.findOne(id, storeId);
  }

  @Get(':id/with-orders')
  @RequirePermissions('customers')
  @ApiOperation({ summary: 'Get customer with their orders' })
  async getCustomerWithOrders(@CurrentUser() user: any, @Param('id') id: string) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.customersService.getCustomerWithOrders(id, storeId);
  }

  @Patch(':id')
  @RequirePermissions('customers')
  @ApiOperation({ summary: 'Update a customer' })
  @ApiResponse({ status: 409, description: 'Another customer already has that phone' })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.customersService.update(id, storeId, forTenant(user, updateCustomerDto));
  }

  @Delete(':id')
  @RequirePermissions('customers')
  @ApiOperation({ summary: 'Delete a customer; their past orders keep the details they were placed with' })
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    const storeId = await this.tenantService.requireStoreId(user);
    await this.customersService.remove(id, storeId);
    return { message: 'Customer deleted' };
  }
}
