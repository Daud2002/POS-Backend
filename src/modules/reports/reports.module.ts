import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, OrderItem } from '../../entities';
import { ReportsController } from './reports.controller';
import { ProfitReportService } from './profit-report.service';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem]),
    // Net profit is gross profit less the ledger.
    ExpensesModule,
  ],
  controllers: [ReportsController],
  providers: [ProfitReportService],
  exports: [ProfitReportService],
})
export class ReportsModule {}
