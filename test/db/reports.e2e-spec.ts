import { DataSource } from 'typeorm';
import { Expense, ExpenseCategory, ExpenseSubcategory, OrderItem } from '../../src/entities';
import { ItemSalesService } from '../../src/modules/reports/item-sales.service';
import { ExpensesService } from '../../src/modules/expenses/expenses.service';
import { ExpenseSubcategoriesService } from '../../src/modules/expenses/expense-subcategories.service';
import { freshDatabase } from '../support/pg';

/**
 * The two GROUP BY reports, against real Postgres: the item sales list
 * (per item, per day, per month) and the expense breakdown by category and
 * subcategory. Mocks cannot tell whether the SQL groups and buckets right.
 */
describe('item sales and expense breakdown', () => {
  let db: DataSource;
  let storeId: string;
  let userId: string;
  let zingerId: string;
  let colaId: string;
  let sequence = 0;

  beforeAll(async () => {
    db = new DataSource(await freshDatabase('cloud', 'reports'));
    await db.initialize();
    await db.runMigrations();

    const [user] = await db.query(
      `INSERT INTO users (email, "passwordHash", role, name) VALUES ('owner@reports.test', 'x', 'store_owner', 'Owner') RETURNING id`,
    );
    userId = user.id;
    const [store] = await db.query(
      `INSERT INTO stores (name, "userId", "accountType") VALUES ('Report Kitchen', $1, 'restaurant') RETURNING id`,
      [userId],
    );
    storeId = store.id;
    const [burgers] = await db.query(`INSERT INTO categories ("storeId", name) VALUES ($1, 'Burgers') RETURNING id`, [storeId]);
    const [drinks] = await db.query(`INSERT INTO categories ("storeId", name) VALUES ($1, 'Drinks') RETURNING id`, [storeId]);
    [{ id: zingerId }] = await db.query(
      `INSERT INTO products ("storeId", "categoryId", name, price) VALUES ($1, $2, 'Zinger', 450) RETURNING id`,
      [storeId, burgers.id],
    );
    [{ id: colaId }] = await db.query(
      `INSERT INTO products ("storeId", "categoryId", name, price) VALUES ($1, $2, 'Cola', 100) RETURNING id`,
      [storeId, drinks.id],
    );

    // 2 Zinger + 1 Cola on 1 Nov, a delivery of 1 Zinger on 2 Nov (charge is
    // not a line, so not item sales), 3 Cola on 1 Dec, and a cancelled order.
    await order('2026-11-01T10:00:00Z', 'completed', [[zingerId, 'Zinger', 2, 450, 'Burgers'], [colaId, 'Cola', 1, 100, 'Drinks']]);
    await order('2026-11-02T12:00:00Z', 'completed', [[zingerId, 'Zinger', 1, 450, 'Burgers']], 150);
    await order('2026-12-01T09:00:00Z', 'completed', [[colaId, 'Cola', 3, 100, 'Drinks']]);
    await order('2026-11-01T11:00:00Z', 'cancelled', [[zingerId, 'Zinger', 5, 450, 'Burgers']]);
    // 20:30 UTC on 2 Nov is 01:30 on 3 Nov in Karachi.
    await order('2026-11-02T20:30:00Z', 'completed', [[colaId, 'Cola', 1, 100, 'Drinks']]);
  });

  afterAll(() => db.destroy());

  async function order(
    settledAt: string,
    orderStatus: 'completed' | 'cancelled',
    lines: Array<[productId: string, name: string, qty: number, unitPrice: number, category: string]>,
    deliveryCharge = 0,
  ) {
    const subtotal = lines.reduce((sum, [, , qty, price]) => sum + qty * price, 0);
    const [row] = await db.query(
      `INSERT INTO orders ("storeId", "orderNumber", "createdById", "orderStatus", status, "orderType",
         subtotal, "deliveryCharge", total, "settledAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        storeId,
        `R-${++sequence}`,
        userId,
        orderStatus,
        orderStatus === 'completed' ? 'paid' : 'cancelled',
        deliveryCharge ? 'delivery' : 'takeaway',
        subtotal,
        deliveryCharge,
        subtotal + deliveryCharge,
        settledAt,
      ],
    );
    for (const [productId, name, qty, unitPrice, category] of lines) {
      await db.query(
        `INSERT INTO order_items ("orderId", "productId", "productName", quantity, "unitPrice", subtotal, total, "categoryName")
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
        [row.id, productId, name, qty, unitPrice, qty * unitPrice, category],
      );
    }
  }

  const itemSales = () => new ItemSalesService(db.getRepository(OrderItem));
  const store = () => ({ id: storeId, accountType: 'restaurant' as const });

  it('totals each item over the window, biggest first, leaving cancelled orders out', async () => {
    const report = await itemSales().report(store(), { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' });
    expect(report.rows).toEqual([
      { period: null, productId: zingerId, name: 'Zinger', category: 'Burgers', quantity: 3, revenue: 1350 },
      { period: null, productId: colaId, name: 'Cola', category: 'Drinks', quantity: 2, revenue: 200 },
    ]);
    expect(report.totals).toEqual({ quantity: 5, revenue: 1550 });
  });

  it('splits per day in the caller\'s zone, newest day first', async () => {
    const report = await itemSales().report(store(), {
      from: '2026-11-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
      groupBy: 'day',
      tz: 'Asia/Karachi',
    });
    expect(report.rows.map((r) => [r.period, r.name, r.quantity])).toEqual([
      ['2026-11-03', 'Cola', 1],
      ['2026-11-02', 'Zinger', 1],
      ['2026-11-01', 'Zinger', 2],
      ['2026-11-01', 'Cola', 1],
    ]);
  });

  it('splits per month and filters by category', async () => {
    const report = await itemSales().report(store(), { groupBy: 'month', category: 'Drinks', tz: 'UTC' });
    expect(report.rows.map((r) => [r.period, r.name, r.quantity, r.revenue])).toEqual([
      ['2026-12', 'Cola', 3, 300],
      ['2026-11', 'Cola', 2, 200],
    ]);
  });

  it('adds expenses up per category and subcategory', async () => {
    const subcategories = new ExpenseSubcategoriesService(
      db.getRepository(ExpenseSubcategory),
      db.getRepository(Expense),
    );
    const [petrol] = await db.query(
      `INSERT INTO expense_categories ("storeId", name) VALUES ($1, 'Petrol') RETURNING id`,
      [storeId],
    );
    const ahmad = await subcategories.findOrCreate(db.manager, storeId, petrol.id, 'Ahmad');
    // Typed again in another case: the same subcategory, not a second one.
    expect((await subcategories.findOrCreate(db.manager, storeId, petrol.id, 'ahmad ')).id).toBe(ahmad.id);
    const bilal = await subcategories.findOrCreate(db.manager, storeId, petrol.id, 'Bilal');

    const book = (amount: number, categoryId: string | null, subcategoryId: string | null) =>
      db.query(
        `INSERT INTO expenses ("storeId", "categoryId", "subcategoryId", title, amount, "expenseDate")
         VALUES ($1, $2, $3, 'Spend', $4, '2026-11-02')`,
        [storeId, categoryId, subcategoryId, amount],
      );
    await book(500, petrol.id, ahmad.id);
    await book(700, petrol.id, ahmad.id);
    await book(300, petrol.id, bilal.id);
    await book(100, petrol.id, null);
    await book(50, null, null);

    const expenses = new ExpensesService(
      db.getRepository(Expense),
      db.getRepository(ExpenseCategory),
      {} as any,
      db as any,
      subcategories,
    );
    const breakdown = await expenses.breakdown(storeId, { from: '2026-11-01', to: '2026-11-30' });
    expect(breakdown).toEqual([
      {
        categoryId: petrol.id,
        name: 'Petrol',
        total: 1600,
        count: 4,
        subcategories: [
          { subcategoryId: ahmad.id, name: 'Ahmad', total: 1200, count: 2 },
          { subcategoryId: bilal.id, name: 'Bilal', total: 300, count: 1 },
          { subcategoryId: null, name: null, total: 100, count: 1 },
        ],
      },
      {
        categoryId: null,
        name: 'Uncategorized',
        total: 50,
        count: 1,
        subcategories: [{ subcategoryId: null, name: null, total: 50, count: 1 }],
      },
    ]);

    // "How much did I pay Ahmad for petrol": the list filter agrees.
    const page = await expenses.findAllPaged(storeId, 0, 20, { categoryId: petrol.id, subcategoryId: ahmad.id });
    expect(page.filteredTotal).toBe(1200);
    expect(page.items.every((e) => e.subcategory?.name === 'Ahmad')).toBe(true);
  });
});
