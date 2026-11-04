import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import {
  CurrentUser,
  PermissionsGuard,
  RequirePermissions,
  Roles,
  RolesGuard,
  TenantService,
  resolvePermissions,
} from '@/common';
import { ProfitReportService } from './profit-report.service';
import { PlatformOverviewService } from './platform-overview.service';
import { ItemSalesService } from './item-sales.service';

/**
 * Store-wide figures that both account types share.
 *
 * Gated on the `dashboard` MODULE rather than a role: a restaurant supervisor
 * or a general-store employee who has been handed the dashboard should see
 * the same numbers the owner does. Expenses are the one part held back —
 * they follow the `expenses` module, so a dashboard without the ledger shows
 * gross profit and no net.
 */
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    private profitReportService: ProfitReportService,
    private platformOverviewService: PlatformOverviewService,
    private itemSalesService: ItemSalesService,
    private tenantService: TenantService,
  ) {}

  /**
   * The platform admin's dashboard, across every store. Not tenant-scoped,
   * which is why it is pinned to the super_admin role rather than a module.
   */
  @Get('platform-overview')
  @Roles('super_admin')
  @RequirePermissions('dashboard')
  @ApiOperation({ summary: 'Store counts, revenue per currency, monthly trend and subscription state across the platform (admin only)' })
  @ApiQuery({
    name: 'tz',
    required: false,
    description: "The admin's IANA zone; months and 'today' are taken in it. Unknown zones fall back to UTC.",
  })
  async platformOverview(@Query('tz') tz?: string) {
    return this.platformOverviewService.overview(tz);
  }

  @Get('profit')
  @RequirePermissions('dashboard')
  @ApiOperation({
    summary: 'Gross and net profit for today, this month, 3 and 6 months, this year and all time',
  })
  @ApiQuery({
    name: 'tz',
    required: false,
    description: "The caller's IANA zone (e.g. Asia/Karachi); windows start at local midnight. Unknown zones fall back to UTC.",
  })
  async profit(@CurrentUser() user: any, @Query('tz') tz?: string) {
    const storeId = await this.tenantService.requireStoreId(user);
    const store = await this.tenantService.getStore(storeId);
    const includeExpenses = resolvePermissions(user).includes('expenses');
    return this.profitReportService.profit(store, tz, includeExpenses);
  }

  @Get('item-sales')
  @RequirePermissions('dashboard')
  @ApiOperation({
    summary: 'Quantity sold and sales per menu item over a window, optionally split per day or month',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO instant, inclusive (settled at or after).' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO instant, exclusive.' })
  @ApiQuery({ name: 'tz', required: false, description: "The caller's IANA zone, for day and month buckets." })
  @ApiQuery({ name: 'groupBy', required: false, enum: ['none', 'day', 'month'] })
  @ApiQuery({ name: 'category', required: false, description: 'Only lines sold under this category name.' })
  async itemSales(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tz') tz?: string,
    @Query('groupBy') groupBy?: string,
    @Query('category') category?: string,
  ) {
    const storeId = await this.tenantService.requireStoreId(user);
    const store = await this.tenantService.getStore(storeId);
    return this.itemSalesService.report(store, { from, to, tz, groupBy, category });
  }
}
