import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee, Order, OrderItem, Store } from '../../entities';
import { ReportsController } from './reports.controller';
import { ProfitReportService } from './profit-report.service';
import { PlatformOverviewService } from './platform-overview.service';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Store, Employee]),
    // Net profit is gross profit less the ledger.
    ExpensesModule,
  ],
  controllers: [ReportsController],
  providers: [ProfitReportService, PlatformOverviewService],
  exports: [ProfitReportService],
})
export class ReportsModule {}
