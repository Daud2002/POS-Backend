import { PlatformOverviewService } from './platform-overview.service';
import { platformRevenuePredicate } from '../../common/revenue';

/** A chainable query builder that records what was selected and filtered. */
function queryBuilder(result: Record<string, unknown>) {
  const qb: any = { selects: [] as string[], wheres: [] as string[], params: {} as Record<string, unknown> };
  for (const method of ['leftJoin', 'innerJoin', 'groupBy', 'addGroupBy', 'orderBy', 'addOrderBy']) {
    qb[method] = jest.fn(() => qb);
  }
  qb.select = jest.fn((expr: string) => { qb.selects = [expr]; return qb; });
  qb.addSelect = jest.fn((expr: string) => { qb.selects.push(expr); return qb; });
  qb.where = jest.fn((expr: string, params?: Record<string, unknown>) => { qb.wheres.push(expr); Object.assign(qb.params, params ?? {}); return qb; });
  qb.andWhere = jest.fn((expr: string, params?: Record<string, unknown>) => { qb.wheres.push(expr); Object.assign(qb.params, params ?? {}); return qb; });
  qb.setParameter = jest.fn((k: string, v: unknown) => { qb.params[k] = v; return qb; });
  qb.setParameters = jest.fn((p: Record<string, unknown>) => { Object.assign(qb.params, p); return qb; });
  return Object.assign(qb, result);
}

function setup() {
  const builders: any[] = [];
  const stores = {
    createQueryBuilder: jest.fn(() => {
      const qb = queryBuilder({
        getRawOne: jest.fn(async () => ({
          total: '5', active: '4', restaurant: '3', subNotSet: '2', subActive: '2', subExpiring: '1', subExpired: '1',
        })),
        getRawMany: jest.fn(async () => [
          { storeId: 's1', name: 'Snack Fuel', accountType: 'restaurant', currency: 'PKR', isActive: true, subscriptionExpiresAt: '2027-01-21', orderCount: '12', revenue: '15000.50' },
          { storeId: 's2', name: 'Quiet Shop', accountType: 'general', currency: 'USD', isActive: false, subscriptionExpiresAt: null, orderCount: '0', revenue: '0' },
        ]),
      });
      builders.push(qb);
      return qb;
    }),
  };
  const orders = {
    createQueryBuilder: jest.fn(() => {
      const qb = queryBuilder({
        getRawMany: jest.fn(async () => [
          { currency: 'PKR', orderCount: '12', revenue: '15000.504', deliveryCharges: '300', month: '2026-10', paymentMethod: 'cash' },
          { currency: 'USD', orderCount: '2', revenue: '40', deliveryCharges: '0', month: '2026-09', paymentMethod: 'card' },
        ]),
      });
      builders.push(qb);
      return qb;
    }),
  };
  const employees = { count: jest.fn(async () => 9) };
  const service = new PlatformOverviewService(orders as any, stores as any, employees as any);
  return { service, builders, orders, stores };
}

describe('PlatformOverviewService.overview', () => {
  it('shapes counts, per-currency revenue and subscription buckets', async () => {
    const { service } = setup();

    const out = await service.overview('Asia/Karachi');

    expect(out.tz).toBe('Asia/Karachi');
    expect(out.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.stores).toEqual({ total: 5, active: 4, inactive: 1, byAccountType: { general: 2, restaurant: 3 } });
    expect(out.employees).toEqual({ total: 9 });
    expect(out.subscriptions).toEqual({ active: 2, expiringWithin7Days: 1, expired: 1, notSet: 2 });
    expect(out.revenueByCurrency).toEqual([
      { currency: 'PKR', orderCount: 12, revenue: 15000.5, deliveryCharges: 300 },
      { currency: 'USD', orderCount: 2, revenue: 40, deliveryCharges: 0 },
    ]);
    expect(out.monthly[0]).toEqual({ month: '2026-10', currency: 'PKR', orderCount: 12, revenue: 15000.5 });
    expect(out.byStore[1]).toMatchObject({ storeId: 's2', isActive: false, subscriptionExpiresAt: null, orderCount: 0, revenue: 0 });
    expect(out.byPaymentMethod[1]).toEqual({ currency: 'USD', paymentMethod: 'card', orderCount: 2, revenue: 40 });
  });

  it('uses the shared revenue rule and shifts months into the caller\'s zone', async () => {
    const { service, builders } = setup();

    await service.overview('Asia/Karachi');

    const predicate = platformRevenuePredicate('o', 's');
    const orderBuilders = builders.filter((qb) => qb.wheres.length);
    expect(orderBuilders.length).toBeGreaterThanOrEqual(3);
    for (const qb of orderBuilders) {
      expect(qb.wheres[0]).toBe(predicate);
    }

    const monthly = builders.find((qb) => qb.selects.some((s: string) => s.includes("date_trunc('month'")));
    expect(monthly).toBeDefined();
    expect(monthly.selects[0]).toContain(`AT TIME ZONE 'UTC') AT TIME ZONE :tz`);
    expect(monthly.params.tz).toBe('Asia/Karachi');
    expect(monthly.params.monthFloor).toBeInstanceOf(Date);
    expect(monthly.groupBy).toHaveBeenCalledWith(monthly.selects[0]);

    // Raw date columns are read as text, never as local-midnight Dates.
    const byStore = builders.find((qb) => qb.selects.some((s: string) => s.includes('to_char("s"."subscriptionExpiresAt"')));
    expect(byStore).toBeDefined();

    // Subscription buckets compare against the caller's calendar day.
    const counts = builders.find((qb) => qb.params.today);
    expect(counts.params.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(counts.params.soon > counts.params.today).toBe(true);
  });

  it('falls back to UTC for an unknown zone', async () => {
    const { service } = setup();
    const out = await service.overview('Mars/Olympus');
    expect(out.tz).toBe('UTC');
  });
});
