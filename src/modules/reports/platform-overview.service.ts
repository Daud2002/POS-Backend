import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee, Order, Store } from '../../entities';
import { selectAggregates } from '../../common/aggregates';
import { round2 } from '../../common/discount';
import { resolveTimeZone, todayInZone, zonedMonthStart } from '../../common/periods';
import { platformRevenuePredicate, revenueAmountExpr, settledAtExpr } from '../../common/revenue';
import { addDays } from '../../common/subscription';

export interface CurrencyTotals {
  currency: string;
  orderCount: number;
  revenue: number;
  deliveryCharges: number;
}

export interface MonthlyTotals {
  /** 'YYYY-MM' in the caller's zone. */
  month: string;
  currency: string;
  orderCount: number;
  revenue: number;
}

export interface StoreTotals {
  storeId: string;
  name: string;
  accountType: string;
  currency: string;
  isActive: boolean;
  subscriptionExpiresAt: string | null;
  orderCount: number;
  revenue: number;
}

export interface PaymentMethodTotals {
  currency: string;
  paymentMethod: string;
  orderCount: number;
  revenue: number;
}

export interface PlatformOverview {
  tz: string;
  /** The calendar day the subscription counts were taken on. */
  today: string;
  stores: {
    total: number;
    active: number;
    inactive: number;
    byAccountType: { general: number; restaurant: number };
  };
  employees: { total: number };
  revenueByCurrency: CurrencyTotals[];
  monthly: MonthlyTotals[];
  byStore: StoreTotals[];
  byPaymentMethod: PaymentMethodTotals[];
  subscriptions: {
    active: number;
    expiringWithin7Days: number;
    expired: number;
    notSet: number;
  };
}

/**
 * The platform admin's numbers, computed in SQL across every store.
 *
 * Revenue is never summed across currencies — a PKR store and a USD store
 * have nothing to add — so every money figure comes back grouped by the
 * store's currency and the dashboard shows one card per currency. Which
 * orders count follows the same rule as every store report
 * (`platformRevenuePredicate`), decided per row from the store's account
 * type, and delivery charges stay outside revenue as they do there.
 *
 * Months are the CALLER's months: the admin's browser sends its IANA zone and
 * the timestamp columns (UTC wall-clock, no zone) are shifted before
 * truncating, so a sale at 11pm in Karachi lands in the right month.
 */
@Injectable()
export class PlatformOverviewService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
  ) {}

  /** `timestamp without time zone` holding UTC → local wall clock in `:tz`. */
  static readonly MONTH_EXPR = `to_char(date_trunc('month', (${settledAtExpr('o')} AT TIME ZONE 'UTC') AT TIME ZONE :tz), 'YYYY-MM')`;

  async overview(tz?: string): Promise<PlatformOverview> {
    const zone = resolveTimeZone(tz);
    const now = new Date();
    const today = todayInZone(now, zone);
    const soon = addDays(today, 7);
    const monthFloor = zonedMonthStart(now, zone, 11);

    const [storeRow, employeeCount, byCurrency, monthly, byStore, byPayment] = await Promise.all([
      this.storeCounts(today, soon),
      this.employees.count(),
      this.revenueByCurrency(),
      this.monthly(zone, monthFloor),
      this.byStore(),
      this.byPaymentMethod(),
    ]);

    const total = int(storeRow.total);
    const active = int(storeRow.active);
    const restaurant = int(storeRow.restaurant);

    return {
      tz: zone,
      today,
      stores: {
        total,
        active,
        inactive: total - active,
        byAccountType: { general: total - restaurant, restaurant },
      },
      employees: { total: employeeCount },
      revenueByCurrency: byCurrency,
      monthly,
      byStore,
      byPaymentMethod: byPayment,
      subscriptions: {
        active: int(storeRow.subActive),
        expiringWithin7Days: int(storeRow.subExpiring),
        expired: int(storeRow.subExpired),
        notSet: int(storeRow.subNotSet),
      },
    };
  }

  private async storeCounts(today: string, soon: string): Promise<Record<string, string>> {
    const qb = this.stores.createQueryBuilder('s').leftJoin('s.owner', 'owner');
    selectAggregates(qb, [
      ['COUNT("s"."id")', 'total'],
      // A store is "active" when its owner can sign in — there is no status on the store itself.
      ['COUNT("s"."id") FILTER (WHERE "owner"."isActive" = true)', 'active'],
      [`COUNT("s"."id") FILTER (WHERE "s"."accountType" = 'restaurant')`, 'restaurant'],
      ['COUNT("s"."id") FILTER (WHERE "s"."subscriptionExpiresAt" IS NULL)', 'subNotSet'],
      ['COUNT("s"."id") FILTER (WHERE "s"."subscriptionExpiresAt" >= :today)', 'subActive'],
      [
        'COUNT("s"."id") FILTER (WHERE "s"."subscriptionExpiresAt" >= :today AND "s"."subscriptionExpiresAt" <= :soon)',
        'subExpiring',
      ],
      ['COUNT("s"."id") FILTER (WHERE "s"."subscriptionExpiresAt" < :today)', 'subExpired'],
    ]);
    qb.setParameters({ today, soon });
    return (await qb.getRawOne<Record<string, string>>()) ?? {};
  }

  private async revenueByCurrency(): Promise<CurrencyTotals[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .innerJoin(Store, 's', '"s"."id" = "o"."storeId"')
      .where(platformRevenuePredicate('o', 's'));
    selectAggregates(qb, [
      ['"s"."currency"', 'currency'],
      ['COUNT("o"."id")', 'orderCount'],
      [`COALESCE(SUM(${revenueAmountExpr('o')}), 0)`, 'revenue'],
      ['COALESCE(SUM(COALESCE("o"."deliveryCharge", 0)), 0)', 'deliveryCharges'],
    ]);
    qb.groupBy('"s"."currency"').orderBy('revenue', 'DESC');

    const rows = await qb.getRawMany<Record<string, string>>();
    return rows.map((row) => ({
      currency: row.currency ?? 'PKR',
      orderCount: int(row.orderCount),
      revenue: money(row.revenue),
      deliveryCharges: money(row.deliveryCharges),
    }));
  }

  private async monthly(zone: string, monthFloor: Date): Promise<MonthlyTotals[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .innerJoin(Store, 's', '"s"."id" = "o"."storeId"')
      .where(platformRevenuePredicate('o', 's'))
      .andWhere(`${settledAtExpr('o')} >= :monthFloor`, { monthFloor })
      .setParameter('tz', zone);
    selectAggregates(qb, [
      [PlatformOverviewService.MONTH_EXPR, 'month'],
      ['"s"."currency"', 'currency'],
      ['COUNT("o"."id")', 'orderCount'],
      [`COALESCE(SUM(${revenueAmountExpr('o')}), 0)`, 'revenue'],
    ]);
    qb.groupBy(PlatformOverviewService.MONTH_EXPR).addGroupBy('"s"."currency"').orderBy('month', 'ASC');

    const rows = await qb.getRawMany<Record<string, string>>();
    return rows.map((row) => ({
      month: row.month,
      currency: row.currency ?? 'PKR',
      orderCount: int(row.orderCount),
      revenue: money(row.revenue),
    }));
  }

  private async byStore(): Promise<StoreTotals[]> {
    // Stores drive the query so a store with no sales still appears at zero.
    const qb = this.stores
      .createQueryBuilder('s')
      .leftJoin('s.owner', 'owner')
      .leftJoin(Order, 'o', `"o"."storeId" = "s"."id" AND ${platformRevenuePredicate('o', 's')}`);
    selectAggregates(qb, [
      ['"s"."id"', 'storeId'],
      ['"s"."name"', 'name'],
      ['"s"."accountType"', 'accountType'],
      ['"s"."currency"', 'currency'],
      ['COALESCE("owner"."isActive", false)', 'isActive'],
      // Raw `date` columns come back as JS Dates at LOCAL midnight; keep the text.
      [`to_char("s"."subscriptionExpiresAt", 'YYYY-MM-DD')`, 'subscriptionExpiresAt'],
      ['COUNT("o"."id")', 'orderCount'],
      [`COALESCE(SUM(${revenueAmountExpr('o')}), 0)`, 'revenue'],
    ]);
    qb.groupBy('"s"."id"')
      .addGroupBy('"s"."name"')
      .addGroupBy('"s"."accountType"')
      .addGroupBy('"s"."currency"')
      .addGroupBy('"owner"."isActive"')
      .addGroupBy('"s"."subscriptionExpiresAt"')
      .orderBy('revenue', 'DESC')
      .addOrderBy('"s"."name"', 'ASC');

    const rows = await qb.getRawMany<Record<string, any>>();
    return rows.map((row) => ({
      storeId: row.storeId,
      name: row.name,
      accountType: row.accountType ?? 'general',
      currency: row.currency ?? 'PKR',
      isActive: row.isActive === true || row.isActive === 'true',
      subscriptionExpiresAt: row.subscriptionExpiresAt ?? null,
      orderCount: int(row.orderCount),
      revenue: money(row.revenue),
    }));
  }

  private async byPaymentMethod(): Promise<PaymentMethodTotals[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .innerJoin(Store, 's', '"s"."id" = "o"."storeId"')
      .where(platformRevenuePredicate('o', 's'));
    selectAggregates(qb, [
      ['"s"."currency"', 'currency'],
      [`COALESCE(CAST("o"."paymentMethod" AS text), 'unknown')`, 'paymentMethod'],
      ['COUNT("o"."id")', 'orderCount'],
      [`COALESCE(SUM(${revenueAmountExpr('o')}), 0)`, 'revenue'],
    ]);
    qb.groupBy('"s"."currency"').addGroupBy('"o"."paymentMethod"').orderBy('revenue', 'DESC');

    const rows = await qb.getRawMany<Record<string, string>>();
    return rows.map((row) => ({
      currency: row.currency ?? 'PKR',
      paymentMethod: row.paymentMethod ?? 'unknown',
      orderCount: int(row.orderCount),
      revenue: money(row.revenue),
    }));
  }
}

/** COUNT() and SUM() over decimals arrive as strings from node-pg. */
function int(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? round2(n) : 0;
}
