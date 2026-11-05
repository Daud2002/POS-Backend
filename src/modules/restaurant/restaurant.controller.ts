import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import {
  Roles,
  RolesGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  TenantService,
  parsePaging,
  wantsCount,
} from '@/common';
import { TablesService } from './tables.service';
import { RestaurantOrdersService, type OrderViewer } from './restaurant-orders.service';
import { RestaurantReportsService } from './restaurant-reports.service';
import {
  AddOrderItemsDto,
  CreateRestaurantOrderDto,
  CreateTableDto,
  CreditOrderDto,
  PrintBillDto,
  RemoveOrderItemsDto,
  SettleCreditDto,
  SettleOrderDto,
  UpdateDraftOrderDto,
  UpdateOrderStatusDto,
  UpdateTableDto,
} from './dto';

/**
 * Who is asking, as the orders service needs it: id, effective role, and the
 * display name that gets snapshotted onto the order's history.
 */
const viewerOf = (user: any): OrderViewer => ({
  userId: user.id,
  role: user.effectiveRole,
  name: user.name ?? null,
});

/**
 * Every route is gated twice: RolesGuard checks the effective role, and
 * `requireRestaurantStore` rejects a general tenant outright, so these
 * endpoints cannot be used to mutate a general store's data.
 *
 * A third gate applies to what used to be owner-only: a supervisor reaches
 * those routes only when the owner has ticked the matching module for them
 * (`@RequirePermissions`), which PermissionsGuard checks. Cashiers, waiters
 * and kitchen staff are never offered those modules, so listing 'supervisor'
 * in @Roles is what opens the door, and the module is what decides.
 */
@ApiTags('Restaurant')
@ApiBearerAuth()
@Controller('restaurant')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class RestaurantController {
  constructor(
    private tablesService: TablesService,
    private ordersService: RestaurantOrdersService,
    private reportsService: RestaurantReportsService,
    private tenantService: TenantService,
  ) {}

  // ------------------------------------------------------------- tables

  @Get('tables')
  @Roles('restaurant_owner', 'waiter', 'kitchen', 'cashier', 'supervisor')
  @ApiOperation({ summary: 'List tables with their live status' })
  async listTables(@CurrentUser() user: any, @Query('includeInactive') includeInactive?: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.tablesService.findAll(store.id, includeInactive === 'true');
  }

  @Post('tables')
  @Roles('restaurant_owner', 'supervisor')
  @RequirePermissions('tables')
  @ApiOperation({ summary: 'Add a table' })
  @ApiResponse({ status: 409, description: 'A table with that name already exists' })
  async createTable(@CurrentUser() user: any, @Body() dto: CreateTableDto) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.tablesService.create(store.id, dto);
  }

  @Patch('tables/:id')
  @Roles('restaurant_owner', 'supervisor')
  @RequirePermissions('tables')
  @ApiOperation({ summary: 'Rename or reactivate a table' })
  async updateTable(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateTableDto) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.tablesService.update(id, store.id, dto);
  }

  @Delete('tables/:id')
  @Roles('restaurant_owner', 'supervisor')
  @RequirePermissions('tables')
  @ApiOperation({ summary: 'Remove a table (soft delete)' })
  async removeTable(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.tablesService.deactivate(id, store.id);
  }

  // ------------------------------------------------------------- orders

  /**
   * Every role sees everything its filters ask for. A printed, unpaid bill
   * stays on every cashier's list until it is settled — see
   * RestaurantOrdersService.baseQuery.
   */
  @Get('orders')
  @Roles('restaurant_owner', 'waiter', 'kitchen', 'cashier', 'supervisor')
  @ApiOperation({ summary: 'List restaurant orders' })
  async listOrders(
    @CurrentUser() user: any,
    @Query('orderStatus') orderStatus?: string,
    @Query('orderType') orderType?: string,
    @Query('tableId') tableId?: string,
    @Query('search') search?: string,
    @Query('billPrinted') billPrinted?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    const filters = { orderStatus, orderType, tableId, search, billPrinted };
    const viewer = viewerOf(user);

    // Opt-in envelope. The kitchen and cashier live views deliberately fetch
    // the complete open set — a ticket pushed onto "page 2" is a ticket that
    // gets missed — so they call without these params and still get an array.
    if (wantsCount(withCount)) {
      return this.ordersService.findAllPaged(store.id, filters, parsePaging(skip, take), viewer);
    }
    return this.ordersService.findAll(store.id, filters, viewer);
  }

  @Get('orders/:id')
  @Roles('restaurant_owner', 'waiter', 'kitchen', 'cashier', 'supervisor')
  @ApiOperation({ summary: 'Get one restaurant order' })
  async getOrder(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.findOne(id, store.id, viewerOf(user));
  }

  /**
   * The order's audit trail. Owners read it from the Orders page; a cashier
   * may read it too, so the till can show what was changed before reprinting.
   */
  @Get('orders/:id/history')
  @Roles('restaurant_owner', 'cashier', 'supervisor')
  @ApiOperation({
    summary: 'Original lines, every add/remove with who did it, and every bill print',
  })
  async orderHistory(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.history(id, store.id, viewerOf(user));
  }

  /**
   * Waiters punch dine-in and dine-out; cashiers take takeaway and delivery —
   * with the discount and delivery charge entered up front and the bill
   * printed as the order is sent (`printBill`).
   */
  @Post('orders')
  @Roles('waiter', 'cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: 'Create an order, as a draft or sent to the kitchen' })
  @ApiResponse({ status: 400, description: 'printBill was sent by a role that cannot claim a bill' })
  @ApiResponse({ status: 409, description: 'The table was claimed by another order' })
  async createOrder(@CurrentUser() user: any, @Body() dto: CreateRestaurantOrderDto) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.create(store.id, viewerOf(user), dto);
  }

  @Patch('orders/:id/draft')
  @Roles('waiter', 'cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: 'Edit a shared draft' })
  @ApiResponse({ status: 409, description: 'Another waiter changed this draft' })
  async updateDraft(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateDraftOrderDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.updateDraft(id, store.id, dto);
  }

  /** Drafts are scratch, so any waiter may bin one — no money or table is involved. */
  @Delete('orders/:id/draft')
  @Roles('waiter', 'cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: 'Discard a draft that was never sent to the kitchen' })
  @ApiResponse({ status: 409, description: 'The order is no longer a draft' })
  async discardDraft(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.discardDraft(id, store.id);
  }

  @Post('orders/:id/punch')
  @Roles('waiter', 'cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: 'Send a draft to the kitchen and claim its table' })
  @ApiResponse({ status: 409, description: 'The table was claimed by another order' })
  async punch(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { tableId?: string },
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.punchDraft(id, store.id, body?.tableId, viewerOf(user));
  }

  @Post('orders/:id/items')
  @Roles('waiter', 'cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({
    summary: 'Append another round to a live order. Drinks lines never reach the kitchen.',
  })
  async addItems(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: AddOrderItemsDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.addItems(id, store.id, dto, viewerOf(user));
  }

  /**
   * The counterpart to adding a round. Not a DELETE route: it takes a body
   * (which lines, how many). Waiters may strike lines at the table; every
   * removal is written to the order's history with who made it.
   */
  @Post('orders/:id/items/remove')
  @Roles('waiter', 'cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({
    summary: 'Strike lines (or part of a line) off a live order. Reprint the bill afterwards.',
  })
  @ApiResponse({ status: 400, description: 'Unknown line, or more than the line holds' })
  @ApiResponse({
    status: 409,
    description: 'Not live, nothing would be left (cancel instead), or a cashier without an open shift',
  })
  async removeItems(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RemoveOrderItemsDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.removeItems(id, store.id, dto, viewerOf(user));
  }

  @Patch('orders/:id/status')
  @Roles('kitchen', 'restaurant_owner', 'supervisor')
  @RequirePermissions('kitchen')
  @ApiOperation({
    summary: 'Kitchen moves an order along: preparing, then handed over to the floor',
  })
  @ApiResponse({ status: 409, description: 'Not a legal transition from the current status' })
  async updateStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.updateStatus(id, store.id, dto);
  }

  /**
   * Step one of taking payment for an order that was not billed at punch
   * time (a waiter's dine-in), and the reprint for any order — including a
   * settled one, which just produces another copy and changes nothing else.
   */
  @Post('orders/:id/print-bill')
  @Roles('cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({
    summary: 'Print or reprint the bill: fix discount and delivery charge on a live order; a settled order is reprinted as is',
  })
  @ApiResponse({ status: 409, description: 'Draft (send it to the kitchen first) or cancelled order' })
  async printBill(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: PrintBillDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.printBill(id, store.id, dto, viewerOf(user));
  }

  /**
   * Step two: the money. Cash is always taken by a cashier, so the caller is
   * recorded as the settler — and, when the tenant has shifts on, must have an
   * open drawer. Any cashier, supervisor or owner may settle a printed bill.
   */
  @Post('orders/:id/settle')
  @Roles('cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: 'Mark a printed bill paid, complete the order, and free the table' })
  @ApiResponse({
    status: 409,
    description: 'The bill has not been printed, or shifts are on and the cashier has none open',
  })
  async settle(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SettleOrderDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.settle(id, store.id, dto, viewerOf(user));
  }

  /** Deliberately excludes the kitchen — cancelling is a money decision. */
  @Post('orders/:id/cancel')
  @Roles('cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: 'Cancel an order and free its table' })
  @ApiResponse({ status: 409, description: 'Already settled, or shifts are on and the cashier has none open' })
  async cancel(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.cancel(id, store.id, viewerOf(user));
  }

  // ------------------------------------------------------- credit sales

  /**
   * The customer walks away owing: the order is completed and its table
   * freed, but no money is taken and nothing reaches a drawer or revenue
   * until somebody collects it. A customer is required. Anyone who works the
   * till may do it; when shifts are on, a cashier or supervisor needs an
   * open one.
   */
  @Post('orders/:id/credit')
  @Roles('cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: 'Put an unpaid order on credit for a customer' })
  @ApiResponse({
    status: 409,
    description: 'Draft, already closed, or shifts are on and the cashier has none open',
  })
  async credit(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreditOrderDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.credit(id, store.id, dto, viewerOf(user));
  }

  /**
   * A credit customer pays. The collector is recorded as the settler and the
   * money goes on their open shift, so it counts for them, today.
   *
   * Cashiers and supervisors only — the owner sees the credit book but does
   * not collect from it (product decision).
   */
  @Post('orders/:id/credit/settle')
  @Roles('cashier', 'supervisor')
  @ApiOperation({ summary: 'Mark a credit order paid' })
  @ApiResponse({
    status: 409,
    description: 'Not a credit order, already paid, or shifts are on and the cashier has none open',
  })
  async settleCredit(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SettleCreditDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.settleCredit(id, store.id, dto, viewerOf(user));
  }

  @Get('credit/customers')
  @Roles('cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: 'Customers with credit orders, and what each still owes' })
  async creditCustomers(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.creditCustomers(store.id, { search, status });
  }

  @Get('credit/customers/:customerId/orders')
  @Roles('cashier', 'supervisor', 'restaurant_owner')
  @ApiOperation({ summary: "One customer's credit orders: unpaid first, then paid, newest first" })
  async creditCustomerOrders(
    @CurrentUser() user: any,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.creditCustomerOrders(store.id, customerId);
  }

  // ------------------------------------------------------------ reports

  @Get('reports/sales')
  @Roles('restaurant_owner', 'supervisor')
  @RequirePermissions('dashboard')
  @ApiOperation({ summary: 'Sales and profit for the owner dashboard' })
  async sales(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.reportsService.sales(store.id, from, to);
  }
}
