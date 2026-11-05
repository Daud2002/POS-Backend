import { DataSource } from 'typeorm';
import {
  CashierShift,
  Customer,
  Order,
  OrderEvent,
  OrderItem,
  Product,
  RestaurantTable,
  Store,
} from '../../src/entities';
import { RestaurantOrdersService } from '../../src/modules/restaurant/restaurant-orders.service';
import { RestaurantReportsService } from '../../src/modules/restaurant/restaurant-reports.service';
import { TablesService } from '../../src/modules/restaurant/tables.service';
import { ShiftsService } from '../../src/modules/shifts/shifts.service';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { ItemSalesService } from '../../src/modules/reports/item-sales.service';
import { freshDatabase } from '../support/pg';

/**
 * Credit sales end to end, against real Postgres: an order served on day 1
 * and put on credit is not revenue, and nobody's drawer holds it; when a
 * different cashier collects it, it is THEIR money, in THEIR shift, on the
 * day it was paid.
 */
describe('credit sales', () => {
  let db: DataSource;
  let orders: RestaurantOrdersService;
  let shifts: ShiftsService;
  let reports: RestaurantReportsService;
  let storeId: string;
  let tableId: string;
  let productId: string;
  let ali: { userId: string; role: string; name: string };
  let sara: { userId: string; role: string; name: string };
  let sequence = 0;

  const realtime = { emitToStore: (): void => undefined } as any;
  const inventory = { consumeForOrder: async (): Promise<unknown[]> => [], emit: (): void => undefined } as any;

  beforeAll(async () => {
    db = new DataSource(await freshDatabase('cloud', 'credit_sales'));
    await db.initialize();
    await db.runMigrations();

    const user = async (email: string, name: string) =>
      (
        await db.query(
          `INSERT INTO users (email, "passwordHash", role, name) VALUES ($1, 'x', 'employee', $2) RETURNING id`,
          [email, name],
        )
      )[0].id as string;
    const owner = await user('owner@credit.test', 'Owner');
    ali = { userId: await user('ali@credit.test', 'Ali'), role: 'cashier', name: 'Ali' };
    sara = { userId: await user('sara@credit.test', 'Sara'), role: 'cashier', name: 'Sara' };

    [{ id: storeId }] = await db.query(
      `INSERT INTO stores (name, "userId", "accountType", "shiftsEnabled") VALUES ('Credit Kitchen', $1, 'restaurant', true) RETURNING id`,
      [owner],
    );
    [{ id: tableId }] = await db.query(
      `INSERT INTO restaurant_tables ("storeId", name) VALUES ($1, 'T1') RETURNING id`,
      [storeId],
    );
    [{ id: productId }] = await db.query(
      `INSERT INTO products ("storeId", name, price) VALUES ($1, 'Karahi', 900) RETURNING id`,
      [storeId],
    );

    const tables = new TablesService(db.getRepository(RestaurantTable), realtime);
    shifts = new ShiftsService(db.getRepository(CashierShift), db.getRepository(Store), realtime, db);
    const customers = new CustomersService(db.getRepository(Customer), db.getRepository(Order), db);
    orders = new RestaurantOrdersService(
      db.getRepository(Order),
      db.getRepository(Product),
      db.getRepository(RestaurantTable),
      db.getRepository(OrderEvent),
      tables,
      shifts,
      customers,
      inventory,
      realtime,
      db,
      {} as any,
    );
    reports = new RestaurantReportsService(db.getRepository(Order));
  });

  afterAll(() => db.destroy());

  /** A served, unpaid dine-in order sitting on T1, opened on `createdAt`. */
  async function servedOrder(createdAt: string, total = 900): Promise<string> {
    const [row] = await db.query(
      `INSERT INTO orders ("storeId", "orderNumber", "orderSequence", "createdById", "orderStatus", status,
         "orderType", "tableId", subtotal, total, "createdAt")
       VALUES ($1, $2, $3, $4, 'handed_over', 'unpaid', 'dine_in', $5, $6, $6, $7) RETURNING id`,
      [storeId, `CR-${++sequence}`, sequence, ali.userId, tableId, total, createdAt],
    );
    await db.query(
      `INSERT INTO order_items ("orderId", "productId", "productName", quantity, "unitPrice", subtotal, total)
       VALUES ($1, $2, 'Karahi', 1, $3, $3, $3)`,
      [row.id, productId, total],
    );
    await db.query(`UPDATE restaurant_tables SET status = 'reserved', "currentOrderId" = $1 WHERE id = $2`, [
      row.id,
      tableId,
    ]);
    return row.id;
  }

  const raw = async (id: string) => (await db.query(`SELECT * FROM orders WHERE id = $1`, [id]))[0];
  const revenueOn = async (from: string, to: string) => (await reports.sales(storeId, from, to)).revenue;

  let firstId: string;
  let customerId: string;

  it('needs an open shift and a customer to put an order on credit', async () => {
    firstId = await servedOrder('2026-11-01T12:00:00Z');

    await expect(orders.credit(firstId, storeId, { customerName: 'Ahmed', customerPhone: '0300-1234567' }, ali))
      .rejects.toThrow(/Open your shift/);

    await shifts.open(storeId, ali.userId, 0);
    await expect(orders.credit(firstId, storeId, {}, ali)).rejects.toThrow(/Choose a customer/);
  });

  it('closes the order and frees the table without taking money', async () => {
    const order = await orders.credit(
      firstId,
      storeId,
      { customerName: 'Ahmed', customerPhone: '0300-1234567' },
      ali,
    );
    expect(order.orderStatus).toBe('completed');
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.creditOwing).toBe(true);
    expect(order.creditedByName).toBe('Ali');
    expect(order.customerName).toBe('Ahmed');

    const row = await raw(firstId);
    expect(row.creditedById).toBe(ali.userId);
    expect(row.settledAt).toBeNull();
    expect(row.settledById).toBeNull();
    expect(row.shiftId).toBeNull();
    customerId = row.customerId;
    expect(customerId).toBeTruthy();

    const [table] = await db.query(`SELECT status, "currentOrderId" FROM restaurant_tables WHERE id = $1`, [tableId]);
    expect(table).toEqual({ status: 'free', currentOrderId: null });

    // Not revenue, on any day, and nobody's drawer holds it.
    expect(await revenueOn('2026-11-01T00:00:00Z', '2027-01-01T00:00:00Z')).toBe(0);
    const items = await new ItemSalesService(db.getRepository(OrderItem)).report(
      { id: storeId, accountType: 'restaurant' },
      {},
    );
    expect(items.totals.revenue).toBe(0);
    expect((await shifts.current(storeId, ali.userId))!.totals.totalSales).toBe(0);

    await expect(orders.credit(firstId, storeId, { customerId }, ali)).rejects.toThrow(/already on credit/);
  });

  it('lists the customer with what they owe', async () => {
    const book = await orders.creditCustomers(storeId);
    expect(book.totals).toEqual({ outstanding: 900, customersOwing: 1, unpaidCount: 1 });
    expect(book.customers).toEqual([
      expect.objectContaining({ customerId, name: 'Ahmed', outstanding: 900, unpaidCount: 1, paidCount: 0 }),
    ]);
    expect((await orders.creditCustomers(storeId, { search: '0300 1234' })).customers).toHaveLength(1);
    expect((await orders.creditCustomers(storeId, { search: 'nobody' })).customers).toHaveLength(0);
  });

  it('books the money to whoever collects it, in their shift, on the day it was paid', async () => {
    await expect(orders.settleCredit(firstId, storeId, { paymentMethod: 'cash' }, sara)).rejects.toThrow(
      /Open your shift/,
    );

    await shifts.open(storeId, sara.userId, 0);
    const paid = await orders.settleCredit(firstId, storeId, { paymentMethod: 'cash' }, sara);
    expect(paid.paymentStatus).toBe('paid');
    expect(paid.settledByName).toBe('Sara');
    expect(paid.creditOwing).toBe(false);

    // Collected today: revenue now, not on 1 Nov when it was served.
    expect(await revenueOn('2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z')).toBe(0);
    expect(await revenueOn(new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 60_000).toISOString())).toBe(900);
    const byCashier = (await reports.sales(storeId)).byCashier;
    expect(byCashier).toEqual([expect.objectContaining({ revenue: 900 })]);

    // Sara's drawer and dashboard hold it; Ali's does not.
    expect((await shifts.current(storeId, sara.userId))!.totals.cashSales).toBe(900);
    expect((await shifts.current(storeId, ali.userId))!.totals.totalSales).toBe(0);
    expect((await shifts.myDashboard(storeId, sara.userId)).range.total).toBe(900);

    const [customer] = await db.query(`SELECT "totalSpent" FROM customers WHERE id = $1`, [customerId]);
    expect(Number(customer.totalSpent)).toBe(900);

    await expect(orders.settleCredit(firstId, storeId, { paymentMethod: 'cash' }, sara)).rejects.toThrow(
      /already been paid/,
    );
  });

  it('lists unpaid credit first, then paid, newest first', async () => {
    const secondId = await servedOrder('2026-11-03T12:00:00Z', 500);
    await orders.credit(secondId, storeId, { customerId }, ali);

    const list = await orders.creditCustomerOrders(storeId, customerId);
    expect(list.map((o) => [o.id, o.paymentStatus])).toEqual([
      [secondId, 'unpaid'],
      [firstId, 'paid'],
    ]);

    const book = await orders.creditCustomers(storeId, { status: 'owing' });
    expect(book.customers).toEqual([
      expect.objectContaining({ customerId, outstanding: 500, unpaidCount: 1, paidCount: 1 }),
    ]);
  });

  it('refuses an order that never went on credit', async () => {
    const plainId = await servedOrder('2026-11-04T12:00:00Z');
    await expect(orders.settleCredit(plainId, storeId, { paymentMethod: 'cash' }, sara)).rejects.toThrow(
      /not a credit sale/,
    );
  });
});
