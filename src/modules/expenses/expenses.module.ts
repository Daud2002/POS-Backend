import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense, ExpenseCategory, ExpenseSubcategory } from '@/entities';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseSubcategoriesService } from './expense-subcategories.service';

import { ShiftsModule } from '../shifts/shifts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Expense, ExpenseCategory, ExpenseSubcategory]),
    // Cash spend booked against the author's open drawer reduces expected cash.
    ShiftsModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseCategoriesService, ExpenseSubcategoriesService],
  exports: [ExpensesService, ExpenseCategoriesService, ExpenseSubcategoriesService],
})
export class ExpensesModule {}
