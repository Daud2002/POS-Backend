import { DataSource } from 'typeorm';
import {
  CashierShift,
  Customer,
  Order,
  OrderEvent,
  Product,
  RestaurantTable,
  Store,
} from '../../src/entities';
import { RestaurantOrdersService } from '../../src/modules/restaurant/restaurant-orders.service';
import { RestaurantReportsService } from '../../src/modules/restaurant/restaurant-reports.service';
import { TablesService } from '../../src/modules/restaurant/tables.service';
import { ShiftsService } from '../../src/modules/shifts/shifts.service';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { revenueAmountExpr, revenuePredicate } from '../../src/common/revenue';
import { freshDatabase } from '../support/pg';

/**
 * Tips end to end, against real Postgres.
 *
 * Ali's shift is the owner's worked example: opening float 1,000 and 5,000
 * received in cash, of which 300 is tips; 200 more in tips by card and online.
 *
 *   bills   cash 4,700 · card 2,600 · online 400   = 7,700 revenue
 *   tips    cash   300 · card   120 · online  80   =   500, never revenue
 *
 * With "card/online tips are taken from cash" on he hands over 5,500; with it
 * off, 5,700.
 */
describe('tips', () => {
  let db: DataSource;
  let orders: RestaurantOrdersService;
  let shifts: ShiftsService;
  let reports: RestaurantReportsService;
  let storeId: string;
  let tableId: string;
  let productId: string;
  let ownerId: string;
  let ali: { userId: string; role: string; name: string };
  let sara: { userId: string; role: string; name: string };
  let sequence = 0;

  const realtime = { emitToStore: (): void => undefined } as any;
  const inventory = { consumeForOrder: async (): Promise<unknown[]> => [], emit: (): void => undefined } as any;

  beforeAll(async () => {
    db = new DataSource(await freshDatabase('cloud', 'tips'));
    await db.initialize();
    await db.runMigrations();

    const user = async (email: string, name: string) =>
      (
        await db.query(
          `INSERT INTO users (email, "passwordHash", role, name) VALUES ($1, 'x', 'employee', $2) RETURNING id`,
          [email, name],
        )
      )[0].id as string;
    ownerId = await user('owner@tips.test', 'Owner');
    ali = { userId: await user('ali@tips.test', 'Ali'), role: 'cashier', name: 'Ali' };
    sara = { userId: await user('sara@tips.test', 'Sara'), role: 'cashier', name: 'Sara' };

    [{ id: storeId }] = await db.query(
      `INSERT INTO stores (name, "userId", "accountType", "shiftsEnabled",
         "tipsCashEnabled", "tipsCardEnabled", "tipsOnlineEnabled", "tipsPaidFromCash")
       VALUES ('Tip Kitchen', $1, 'restaurant', true, true, true, true, true) RETURNING id`,
      [ownerId],
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

  /** A served order with its bill printed, ready to be paid. Seated types take T1. */
  async function billedOrder(orderType: string, total: number): Promise<string> {
    const seated = orderType === 'dine_in' || orderType === 'dine_out';
    const [row] = await db.query(
      `INSERT INTO orders ("storeId", "orderNumber", "orderSequence", "createdById", "orderStatus", status,
         "orderType", "tableId", subtotal, total, "billPrintedAt", "billPrintedById")
       VALUES ($1, $2, $3, $4, 'handed_over', 'unpaid', $5, $6, $7, $7, now(), $4) RETURNING id`,
      [storeId, `TIP-${++sequence}`, sequence, ali.userId, orderType, seated ? tableId : null, total],
    );
    await db.query(
      `INSERT INTO order_items ("orderId", "productId", "productName", quantity, "unitPrice", subtotal, total)
       VALUES ($1, $2, 'Karahi', 1, $3, $3, $3)`,
      [row.id, productId, total],
    );
    if (seated) {
      await db.query(`UPDATE restaurant_tables SET status = 'reserved', "currentOrderId" = $1 WHERE id = $2`, [
        row.id,
        tableId,
      ]);
    }
    return row.id;
  }

  const raw = async (id: string) => (await db.query(`SELECT * FROM orders WHERE id = $1`, [id]))[0];
  const setStore = (column: string, value: boolean) =>
    db.query(`UPDATE stores SET "${column}" = $1 WHERE id = $2`, [value, storeId]);
  const aliTotals = async () => (await shifts.current(storeId, ali.userId))!.totals;

  let aliShiftId: string;
  let splitId: string;

  it('stores the tip beside the bill, never in it', async () => {
    const shift = await shifts.open(storeId, ali.userId, 1000);
    aliShiftId = shift!.id;

    // Dine-in, cash: 3,200 received on a 3,000 bill.
    const cashId = await billedOrder('dine_in', 3000);
    const paid = await orders.settle(
      cashId,
      storeId,
      { paymentMethod: 'cash', tipAmount: 200, expectedTotal: 3000 },
      ali,
    );
    expect(Number(paid.total)).toBe(3000);
    expect(Number(paid.tipAmount)).toBe(200);
    expect(paid.tipMethod).toBe('cash');

    const row = await raw(cashId);
    expect(Number(row.total)).toBe(3000);
    // The paid columns are the bill, so no sales figure built on them sees the tip.
    expect(Number(row.paidCash)).toBe(3000);
    expect(Number(row.tipAmount)).toBe(200);
    expect(row.tipMethod).toBe('cash');

    // Takeaway, cash: 1,800 on 1,700.
    await orders.settle(
      await billedOrder('takeaway', 1700),
      storeId,
      { paymentMethod: 'cash', tipAmount: 100 },
      ali,
    );
    // Delivery, card: 2,120 on 2,000. The method follows the payment.
    const cardOrder = await orders.settle(
      await billedOrder('delivery', 2000),
      storeId,
      { paymentMethod: 'card', tipAmount: 120 },
      ali,
    );
    expect(cardOrder.tipMethod).toBe('card');

    // Dine-out, split 600 card + 400 online, and 80 more online as the tip.
    // The split still adds up to the bill alone; the tip rides beside it.
    splitId = await billedOrder('dine_out', 1000);
    const split = await orders.settle(
      splitId,
      storeId,
      { paymentMethod: 'partial', split: { card: 600, online: 400 }, tipAmount: 80, tipMethod: 'online' },
      ali,
    );
    expect(split.paymentMethod).toBe('partial');
    const splitRow = await raw(splitId);
    expect([Number(splitRow.paidCard), Number(splitRow.paidOnline)]).toEqual([600, 400]);
    expect(Number(splitRow.tipAmount)).toBe(80);
  });

  it('keeps tips out of every revenue figure', async () => {
    const report = await reports.sales(storeId);
    expect(report.revenue).toBe(7700);
    expect(report.tipTotal).toBe(500);
    expect(report.averageOrderValue).toBe(1925);
    expect(report.byCashier).toEqual([expect.objectContaining({ name: 'Ali', revenue: 7700 })]);
    expect(report.byOrderType.reduce((sum, t) => sum + t.revenue, 0)).toBe(7700);

    // The shared rule the profit cards and the platform overview sum with.
    const [{ revenue }] = await db.query(
      `SELECT COALESCE(SUM(${revenueAmountExpr('o')}), 0) AS revenue
         FROM orders o WHERE o."storeId" = $1 AND ${revenuePredicate('o', 'restaurant')}`,
      [storeId],
    );
    expect(Number(revenue)).toBe(7700);

    const dashboard = await shifts.myDashboard(storeId, ali.userId);
    expect(dashboard.range.total).toBe(7700);
    expect(dashboard.range.tips).toBe(500);
    expect([dashboard.range.cash, dashboard.range.card, dashboard.range.online]).toEqual([4700, 2600, 400]);
  });

  it('lists tips by order type and method, dine-out under dine-in', async () => {
    const expected = [
      { orderType: 'dine_in', method: 'cash', amount: 200 },
      { orderType: 'dine_in', method: 'online', amount: 80 },
      { orderType: 'takeaway', method: 'cash', amount: 100 },
      { orderType: 'delivery', method: 'card', amount: 120 },
    ];
    expect((await reports.sales(storeId)).tipsBreakdown).toEqual(expected);
    expect((await aliTotals()).tipsBreakdown).toEqual(expected);
    expect((await shifts.myDashboard(storeId, ali.userId)).range.tipsBreakdown).toEqual(expected);
  });

  it('takes tips off the cash to hand over', async () => {
    // Taken from cash: 6,000 − 300 − 200.
    const on = await aliTotals();
    expect(on).toMatchObject({
      cashSales: 4700,
      cardSales: 2600,
      onlineSales: 400,
      totalSales: 7700,
      cashTips: 300,
      cardTips: 120,
      onlineTips: 80,
      tipTotal: 500,
      totalReceived: 8200,
      cashReceived: 5000,
      cashInDrawer: 6000,
      tipsFromDrawer: 200,
      tipsOwed: 0,
      expectedCash: 5500,
    });

    // Not taken from cash: 6,000 − 300. The 200 stays with the card/online money.
    await setStore('tipsPaidFromCash', false);
    const off = await aliTotals();
    expect(off).toMatchObject({ cashInDrawer: 6000, tipsFromDrawer: 0, expectedCash: 5700, tipTotal: 500 });

    await setStore('tipsPaidFromCash', true);
  });

  it('refuses a payment it cannot record honestly, and leaves the order unpaid', async () => {
    const id = await billedOrder('takeaway', 900);
    const unpaid = async () => {
      const row = await raw(id);
      expect([row.status, row.orderStatus, Number(row.tipAmount)]).toEqual(['unpaid', 'handed_over', 0]);
    };

    // A split is still the bill to the cent — a tip cannot hide inside it.
    await expect(
      orders.settle(id, storeId, { paymentMethod: 'partial', split: { cash: 500, card: 500 } }, ali),
    ).rejects.toThrow(/split adds up to 1000\.00/);
    await unpaid();

    // The till was looking at a different bill.
    await expect(
      orders.settle(id, storeId, { paymentMethod: 'cash', tipAmount: 100, expectedTotal: 1000 }, ali),
    ).rejects.toThrow(/now 900\.00/);
    await unpaid();

    // A split has to say which part the tip came by.
    await expect(
      orders.settle(id, storeId, { paymentMethod: 'partial', split: { cash: 400, card: 500 }, tipAmount: 50 }, ali),
    ).rejects.toThrow(/cash, card or online/);
    await unpaid();

    // The owner stopped recording online tips.
    await setStore('tipsOnlineEnabled', false);
    await expect(orders.settle(id, storeId, { paymentMethod: 'online', tipAmount: 50 }, ali)).rejects.toThrow(
      /Tips by online/,
    );
    await unpaid();

    // ...which never blocks a payment without one, and never loses tips already taken.
    const paid = await orders.settle(id, storeId, { paymentMethod: 'online' }, ali);
    expect(paid.paymentStatus).toBe('paid');
    expect(Number(paid.tipAmount)).toBe(0);
    expect(paid.tipMethod).toBeNull();
    expect((await aliTotals()).onlineTips).toBe(80);
    await setStore('tipsOnlineEnabled', true);

    await expect(orders.settle(id, storeId, { paymentMethod: 'cash', tipAmount: 10 }, ali)).rejects.toThrow(
      /already settled/,
    );
    // The first cashier's record stands.
    expect((await raw(id)).paymentMethod).toBe('online');
  });

  let saraShiftId: string;

  it('books a tip left when a credit sale is collected to whoever collects it', async () => {
    const id = await billedOrder('dine_in', 900);
    await orders.credit(id, storeId, { customerName: 'Ahmed', customerPhone: '0300-1234567' }, ali);

    const sarasShift = await shifts.open(storeId, sara.userId, 0);
    saraShiftId = sarasShift!.id;
    const paid = await orders.settleCredit(
      id,
      storeId,
      { paymentMethod: 'cash', tipAmount: 50, expectedTotal: 900 },
      sara,
    );
    expect(paid.paymentStatus).toBe('paid');
    expect(Number(paid.tipAmount)).toBe(50);

    expect((await shifts.current(storeId, sara.userId))!.totals).toMatchObject({
      cashSales: 900,
      cashTips: 50,
      cashReceived: 950,
      expectedCash: 900,
    });
    // Ali served it; none of it is in his drawer. His shift now also holds the
    // 900 online payment from the refusals test: 7,700 + 900.
    expect(await aliTotals()).toMatchObject({ totalSales: 8600, tipTotal: 500, expectedCash: 5500 });

    // The customer's spend is the bill. The tip was not spent at the restaurant.
    const [customer] = await db.query(`SELECT "totalSpent" FROM customers WHERE id = $1`, [
      (await raw(id)).customerId,
    ]);
    expect(Number(customer.totalSpent)).toBe(900);

    expect((await reports.sales(storeId)).revenue).toBe(9500);
    expect((await reports.sales(storeId)).tipTotal).toBe(550);
  });

  it('freezes the handover at close, whatever the setting does afterwards', async () => {
    const closed = await shifts.close(aliShiftId, storeId, { id: ali.userId, role: 'cashier' }, { countedCash: 5500 });
    expect(closed.status).toBe('closed');
    expect(closed.difference).toBe(0);
    expect(closed).toMatchObject({ cashTips: 300, cardTips: 120, onlineTips: 80, tipsFromDrawer: 200 });
    expect(closed.totals).toMatchObject({ expectedCash: 5500, tipTotal: 500, cashInDrawer: 6000 });
    expect(closed.totals.tipsBreakdown).toHaveLength(4);

    await setStore('tipsPaidFromCash', false);
    const later = await shifts.findOne(aliShiftId, storeId, { id: ownerId, role: 'store_owner' });
    expect(later.totals).toMatchObject({ expectedCash: 5500, tipsFromDrawer: 200, tipTotal: 500 });
    expect(later.totals.tipsBreakdown).toEqual(closed.totals.tipsBreakdown);

    const summary = await shifts.summaryByCashier(storeId);
    expect(summary.find((row) => row.userId === ali.userId)).toMatchObject({
      totalSales: 8600,
      tipTotal: 500,
      cashTips: 300,
      cardTips: 120,
      onlineTips: 80,
      expectedCash: 5500,
    });
    await setStore('tipsPaidFromCash', true);
  });

  it('snapshots tips on an owner force-close too', async () => {
    const closed = await shifts.close(
      saraShiftId,
      storeId,
      { id: ownerId, role: 'store_owner' },
      { countedCash: null },
    );
    expect(closed.status).toBe('closed');
    expect(closed.difference).toBeNull();
    expect(closed).toMatchObject({ cashTips: 50, cardTips: 0, onlineTips: 0, tipsFromDrawer: 0, expectedCash: 900 });
  });
});
