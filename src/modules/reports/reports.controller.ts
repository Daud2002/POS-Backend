import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import {
  CurrentUser,
  PermissionsGuard,
  RequirePermissions,
  RolesGuard,
  TenantService,
  resolvePermissions,
} from '@/common';
import { ProfitReportService } from './profit-report.service';

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
    private tenantService: TenantService,
  ) {}

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
}
