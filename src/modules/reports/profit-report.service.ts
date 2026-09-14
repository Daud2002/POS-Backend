import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderItem, Store } from '../../entities';
import { round2 } from '../../common/discount';
import { PERIOD_KEYS, periodStarts, type PeriodKey } from '../../common/periods';
import { ExpensesService } from '../expenses/expenses.service';

export interface ProfitPeriod {
  orderCount: number;
  /** What was charged for the goods — delivery charges excluded. */
  revenue: number;
  /** Σ unitCost × quantity over the lines sold, from the cost snapshot. */
  cost: number;
  grossProfit: number;
  /** Lines with no cost recorded, so `cost` is understated by them. */
  unknownCostLineCount: number;
  /** Null when the caller may not see the ledger. */
  expenses: number | null;
  netProfit: number | null;
}

export interface ProfitReport {
  tz: string;
  periods: Record<PeriodKey, ProfitPeriod>;
}

/**
 * Gross and net profit over the six windows every dashboard shows.
 *
 * Gross profit is what the goods sold for minus what they cost, using the
 * `unitCost` snapshot taken on each line when it was sold — the same rule as
 * the restaurant sales report, so the two never disagree. Net profit takes
 * the expense ledger off that.
 *
 * Aggregated in SQL rather than by loading every order: "all time" on a busy
 * store is tens of thousands of rows, and there are six windows. One
 * `SUM ... FILTER` column per window turns that into two table scans.
 */
@Injectable()
export class ProfitReportService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private orderItemsRepository: Repository<OrderItem>,
    private expensesService: ExpensesService,
  ) {}

  async profit(store: Store, tz: string | undefined, includeExpenses: boolean): Promise<ProfitReport> {
    const starts = periodStarts(new Date(), tz);

    const [orderRows, itemRows, expenses] = await Promise.all([
      this.orderTotals(store, starts.instants),
      this.itemCosts(store, starts.instants),
      includeExpenses ? this.expensesService.sumByPeriods(store.id, starts.days) : null,
    ]);

    const periods = {} as Record<PeriodKey, ProfitPeriod>;
    for (const key of PERIOD_KEYS) {
      const revenue = round2(orderRows[key].revenue);
      const cost = round2(itemRows[key].cost);
      const grossProfit = round2(revenue - cost);
      const spend = expenses ? round2(expenses[key]) : null;
      periods[key] = {
        orderCount: orderRows[key].orderCount,
        revenue,
        cost,
        grossProfit,
        unknownCostLineCount: itemRows[key].unknownCostLineCount,
        expenses: spend,
        netProfit: spend === null ? null : round2(grossProfit - spend),
      };
    }

    return { tz: starts.tz, periods };
  }

  /**
   * Which orders count as money taken.
   *
   * A restaurant order is revenue once the cashier settles it (`orderStatus`
   * = 'completed'); drafts, live tickets and cancellations are not. A general
   * store's orders never move through that lifecycle — they carry
   * `orderStatus` 'none' and settle by payment status instead.
   */
  private revenuePredicate(store: Store): string {
    return store.accountType === 'restaurant'
      ? `"o"."orderStatus" = 'completed'`
      : `"o"."status" IN ('paid', 'completed')`;
  }

  /**
   * Windowed on when the money was TAKEN, falling back to creation for rows
   * that predate settledAt — identical to the sales report.
   */
  private static readonly SETTLED_AT = `COALESCE("o"."settledAt", "o"."createdAt")`;

  private async orderTotals(
    store: Store,
    instants: Record<PeriodKey, Date | null>,
  ): Promise<Record<PeriodKey, { orderCount: number; revenue: number }>> {
    // Every column is fully quoted: the alias has to survive TypeORM's own
    // rewriting of `alias.property` inside multi-line raw fragments.
    const qb = this.ordersRepository
      .createQueryBuilder('o')
      .where('"o"."storeId" = :storeId', { storeId: store.id })
      .andWhere(this.revenuePredicate(store));

    for (const key of PERIOD_KEYS) {
      const from = instants[key];
      const filter = from ? ` FILTER (WHERE ${ProfitReportService.SETTLED_AT} >= :${key})` : '';
      if (from) qb.setParameter(key, from);
      qb.addSelect(`COUNT("o"."id")${filter}`, `${key}_count`);
      // Delivery charges are collected cash but not a sale of anything with a
      // cost against it, so they sit outside revenue — as in the sales report.
      qb.addSelect(
        `COALESCE(SUM("o"."total" - COALESCE("o"."deliveryCharge", 0))${filter}, 0)`,
        `${key}_revenue`,
      );
    }

    const row = (await qb.getRawOne<Record<string, string>>()) ?? {};
    const out = {} as Record<PeriodKey, { orderCount: number; revenue: number }>;
    for (const key of PERIOD_KEYS) {
      out[key] = {
        orderCount: Number(row[`${key}_count`]) || 0,
        revenue: Number(row[`${key}_revenue`]) || 0,
      };
    }
    return out;
  }

  private async itemCosts(
    store: Store,
    instants: Record<PeriodKey, Date | null>,
  ): Promise<Record<PeriodKey, { cost: number; unknownCostLineCount: number }>> {
    // Kept as a second query: joining items onto the order query would
    // multiply every order total by its line count.
    const qb = this.orderItemsRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .where('"o"."storeId" = :storeId', { storeId: store.id })
      .andWhere(this.revenuePredicate(store));

    for (const key of PERIOD_KEYS) {
      const from = instants[key];
      const inWindow = from ? `${ProfitReportService.SETTLED_AT} >= :${key}` : 'TRUE';
      if (from) qb.setParameter(key, from);
      qb.addSelect(
        `COALESCE(SUM(COALESCE("oi"."unitCost", 0) * "oi"."quantity") FILTER (WHERE ${inWindow}), 0)`,
        `${key}_cost`,
      );
      qb.addSelect(
        `COUNT(*) FILTER (WHERE "oi"."unitCost" IS NULL AND ${inWindow})`,
        `${key}_unknown`,
      );
    }

    const row = (await qb.getRawOne<Record<string, string>>()) ?? {};
    const out = {} as Record<PeriodKey, { cost: number; unknownCostLineCount: number }>;
    for (const key of PERIOD_KEYS) {
      out[key] = {
        cost: Number(row[`${key}_cost`]) || 0,
        unknownCostLineCount: Number(row[`${key}_unknown`]) || 0,
      };
    }
    return out;
  }
}
