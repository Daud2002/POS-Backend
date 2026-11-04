import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category, OrderItem, Product, Store } from '../../entities';
import { selectAggregates, type AggregateColumn } from '../../common/aggregates';
import { round2 } from '../../common/discount';
import { resolveTimeZone } from '../../common/periods';
import { revenuePredicate, settledAtExpr } from '../../common/revenue';

export const ITEM_SALES_GROUPINGS = ['none', 'day', 'month'] as const;
export type ItemSalesGrouping = (typeof ITEM_SALES_GROUPINGS)[number];

export interface ItemSalesRow {
  /** 'YYYY-MM-DD' (day) or 'YYYY-MM' (month) in the caller's zone; null when not grouped by period. */
  period: string | null;
  productId: string;
  name: string;
  category: string | null;
  quantity: number;
  /** Σ line totals — before any discount taken off the whole order. */
  revenue: number;
}

export interface ItemSalesReport {
  tz: string;
  groupBy: ItemSalesGrouping;
  rows: ItemSalesRow[];
  totals: { quantity: number; revenue: number };
}

export interface ItemSalesQuery {
  from?: string;
  to?: string;
  tz?: string;
  groupBy?: string;
  category?: string;
}

const PERIOD_FORMAT: Record<Exclude<ItemSalesGrouping, 'none'>, string> = {
  day: 'YYYY-MM-DD',
  month: 'YYYY-MM',
};

/**
 * What each menu item sold, in one GROUP BY.
 *
 * The same orders count as everywhere else (`revenuePredicate`), windowed on
 * when the money was taken (`settledAtExpr`), so the item list and the
 * dashboard agree on which sales happened. Lines carry their own name and
 * category snapshot, so an item renamed or moved later still reports under
 * what it was sold as; general-store lines that predate the category snapshot
 * fall back to the product's current category.
 */
@Injectable()
export class ItemSalesService {
  constructor(
    @InjectRepository(OrderItem)
    private items: Repository<OrderItem>,
  ) {}

  /** The category a line reports under: its snapshot, else the product's current one. */
  private static readonly CATEGORY = `COALESCE("oi"."categoryName", "c"."name")`;

  async report(store: Pick<Store, 'id' | 'accountType'>, query: ItemSalesQuery): Promise<ItemSalesReport> {
    const tz = resolveTimeZone(query.tz);
    const groupBy: ItemSalesGrouping = (ITEM_SALES_GROUPINGS as readonly string[]).includes(query.groupBy ?? '')
      ? (query.groupBy as ItemSalesGrouping)
      : 'none';
    const from = parseInstant(query.from, 'from');
    const to = parseInstant(query.to, 'to');

    const qb = this.items
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .leftJoin(Product, 'p', '"p"."id" = "oi"."productId"')
      .leftJoin(Category, 'c', '"c"."id" = "p"."categoryId"')
      .where('"o"."storeId" = :storeId', { storeId: store.id })
      .andWhere(revenuePredicate('o', store.accountType));

    // `to` is exclusive, so "today" is [midnight, next midnight).
    if (from) qb.andWhere(`${settledAtExpr('o')} >= :from`, { from });
    if (to) qb.andWhere(`${settledAtExpr('o')} < :to`, { to });
    const category = query.category?.trim();
    if (category) qb.andWhere(`${ItemSalesService.CATEGORY} = :category`, { category });

    // Timestamps are UTC wall-clock with no zone, so they are shifted into the
    // caller's zone before truncating — a sale at 11pm lands on the right day.
    const period =
      groupBy === 'none'
        ? null
        : `to_char(date_trunc('${groupBy}', (${settledAtExpr('o')} AT TIME ZONE 'UTC') AT TIME ZONE :tz), '${PERIOD_FORMAT[groupBy]}')`;

    const columns: AggregateColumn[] = [
      ['"oi"."productId"', 'productId'],
      [`COALESCE(MAX("oi"."productName"), MAX("p"."name"), 'Unknown')`, 'name'],
      [`MAX(${ItemSalesService.CATEGORY})`, 'category'],
      ['COALESCE(SUM("oi"."quantity"), 0)', 'quantity'],
      ['COALESCE(SUM("oi"."total"), 0)', 'revenue'],
    ];
    if (period) {
      columns.unshift([period, 'period']);
      qb.setParameter('tz', tz);
    }
    selectAggregates(qb, columns);

    qb.groupBy('"oi"."productId"');
    if (period) qb.addGroupBy(period).orderBy('period', 'DESC').addOrderBy('revenue', 'DESC');
    else qb.orderBy('revenue', 'DESC');
    qb.addOrderBy('name', 'ASC');

    const raw = await qb.getRawMany<Record<string, string | null>>();
    const rows: ItemSalesRow[] = raw.map((row) => ({
      period: row.period ?? null,
      productId: row.productId as string,
      name: row.name ?? 'Unknown',
      category: row.category ?? null,
      quantity: Math.trunc(Number(row.quantity) || 0),
      revenue: round2(Number(row.revenue) || 0),
    }));

    return {
      tz,
      groupBy,
      rows,
      totals: {
        quantity: rows.reduce((sum, r) => sum + r.quantity, 0),
        revenue: round2(rows.reduce((sum, r) => sum + r.revenue, 0)),
      },
    };
  }
}

/** An ISO instant from the query string, or undefined. A typo is a 400, not an empty report. */
function parseInstant(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`'${name}' must be an ISO date-time`);
  }
  return date;
}
