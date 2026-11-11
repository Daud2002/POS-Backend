import { TwoSides, seedRestaurant } from './support/two-sides';

/**
 * The whole loop between a cloud and a store server: pairing, the first
 * copy, activation, and the shop carrying on with no internet.
 */
describe('cloud ⇄ store server', () => {
  const sides = new TwoSides();
  let seed: Awaited<ReturnType<typeof seedRestaurant>>;
  let serverId: string;

  beforeAll(async () => {
    await sides.start('roundtrip');
    seed = await seedRestaurant(sides.cloud);

    const { code } = await sides.servers.createPairingCode(seed.storeId, seed.ownerId);
    const paired = await sides.storeSync.pair(code, 'https://cloud.test/api');
    serverId = (await sides.storeSync.state()).server_id!;
    expect(paired.storeName).toBe('Snack Test');
  });

  afterAll(() => sides.stop());

  const one = async (db: 'cloud' | 'store', sql: string, params: unknown[] = []) =>
    (await sides[db].query(sql, params))[0];

  it('copies the store down on pairing, and nothing else', async () => {
    expect(await one('store', `SELECT name, currency FROM stores`)).toEqual({ name: 'Snack Test', currency: 'PKR' });
    expect(await one('store', `SELECT count(*)::int AS n FROM users`)).toEqual({ n: 2 });
    expect(await one('store', `SELECT name, price::float AS price, stock FROM products`)).toEqual({
      name: 'Zinger',
      price: 450,
      stock: 20,
    });
    // Not writable until the owner activates it.
    expect((await sides.storeSync.state()).writable).toBe(false);
  });

  it('becomes the writer once activated, and the cloud stops taking orders', async () => {
    await sides.servers.activate(seed.storeId, serverId);
    await sides.sync();

    expect((await sides.storeSync.state()).writable).toBe(true);
    expect(await one('store', `SELECT "operationMode", "writerServerId"::text AS w FROM stores`)).toEqual({
      operationMode: 'server',
      w: serverId,
    });
    await expect(
      sides.cloud.query(
        `INSERT INTO orders ("storeId", "orderNumber", "createdById", subtotal, total) VALUES ($1, 'ORD-CLOUD', $2, 0, 0)`,
        [seed.storeId, seed.waiterId],
      ),
    ).rejects.toThrow(/TNT_STORE_SERVER_MODE/);
  });

  it('takes orders with no internet and hands them over when it is back', async () => {
    sides.offline = true;

    const [order] = await sides.store.query(
      `INSERT INTO orders ("storeId", "orderNumber", "orderSequence", "createdById", "tableId", subtotal, total, "orderStatus")
       VALUES ($1, 'ORD-SHOP-1', 1, $2, $3, 900, 900, 'requested') RETURNING id`,
      [seed.storeId, seed.waiterId, seed.tableId],
    );
    await sides.store.query(
      `INSERT INTO order_items ("orderId", "productId", "productName", quantity, "unitPrice", subtotal, total)
       VALUES ($1, $2, 'Zinger', 2, 450, 900, 900)`,
      [order.id, seed.productId],
    );
    await sides.store.query(`UPDATE products SET stock = stock - 2 WHERE id = $1`, [seed.productId]);
    await sides.storeSync.syncNow(); // fails quietly: no internet

    expect((await sides.storeSync.status()).lastSyncError).toMatch(/No connection/);
    expect(await one('cloud', `SELECT count(*)::int AS n FROM orders`)).toEqual({ n: 0 });

    sides.offline = false;
    await sides.sync();

    expect(await one('cloud', `SELECT "orderNumber", total::float AS total FROM orders`)).toEqual({
      orderNumber: 'ORD-SHOP-1',
      total: 900,
    });
    expect(await one('cloud', `SELECT quantity FROM order_items`)).toEqual({ quantity: 2 });
    expect(await one('cloud', `SELECT stock FROM products`)).toEqual({ stock: 18 });
  });

  it('adds up stock moved on both sides instead of keeping one', async () => {
    // A stock-in from home and a sale in the shop, at the same time.
    await sides.cloud.query(`UPDATE products SET stock = stock + 10 WHERE id = $1`, [seed.productId]);
    await sides.store.query(`UPDATE products SET stock = stock - 1 WHERE id = $1`, [seed.productId]);
    await sides.sync();

    expect(await one('cloud', `SELECT stock FROM products`)).toEqual({ stock: 27 });
    expect(await one('store', `SELECT stock FROM products`)).toEqual({ stock: 27 });
  });

  it('keeps the newest of two menu edits, on both sides', async () => {
    await sides.store.query(`UPDATE products SET price = 470 WHERE id = $1`, [seed.productId]);
    await new Promise((r) => setTimeout(r, 5));
    await sides.cloud.query(`UPDATE products SET price = 499, name = 'Zinger Deluxe' WHERE id = $1`, [seed.productId]);
    await sides.sync();

    const expected = { name: 'Zinger Deluxe', price: 499 };
    expect(await one('cloud', `SELECT name, price::float AS price FROM products`)).toEqual(expected);
    expect(await one('store', `SELECT name, price::float AS price FROM products`)).toEqual(expected);
  });

  it('carries a price change down without touching the shop’s table state', async () => {
    await sides.store.query(`UPDATE restaurant_tables SET status = 'reserved' WHERE id = $1`, [seed.tableId]);
    await sides.cloud.query(`UPDATE restaurant_tables SET name = 'Window 1' WHERE id = $1`, [seed.tableId]);
    await sides.sync();

    const expected = { name: 'Window 1', status: 'reserved' };
    expect(await one('cloud', `SELECT name, status FROM restaurant_tables`)).toEqual(expected);
    expect(await one('store', `SELECT name, status FROM restaurant_tables`)).toEqual(expected);
  });

  it('refuses to delete a product the shop’s orders still point at', async () => {
    // The cloud has no order lines for it after a failover-free run? It does:
    // the shop's order arrived above. Delete it on the cloud anyway, as a
    // script might, by removing the lines first there.
    await sides.cloud.query(`SELECT set_config('tnt.applying', 'on', false)`);
    await sides.cloud.query(`DELETE FROM order_items`);
    await sides.cloud.query(`SELECT set_config('tnt.applying', 'off', false)`);
    await sides.cloud.query(`DELETE FROM products WHERE id = $1`, [seed.productId]);
    await sides.sync();
    await sides.sync();

    // The shop still sells it, so it stays — and comes back to the cloud.
    expect(await one('store', `SELECT count(*)::int AS n FROM products`)).toEqual({ n: 1 });
    expect(await one('cloud', `SELECT count(*)::int AS n FROM products`)).toEqual({ n: 1 });
  });

  it('settles two categories created offline in the same slot', async () => {
    sides.offline = true;
    await sides.cloud.query(`INSERT INTO categories ("storeId", name, "sortOrder") VALUES ($1, 'Drinks', 2)`, [seed.storeId]);
    await sides.store.query(`INSERT INTO categories ("storeId", name, "sortOrder") VALUES ($1, 'Sides', 2)`, [seed.storeId]);
    sides.offline = false;
    await sides.sync();
    await sides.sync();

    const list = `SELECT name, "sortOrder" FROM categories ORDER BY "sortOrder"`;
    const cloud = await sides.cloud.query(list);
    expect(cloud).toHaveLength(3);
    expect(new Set(cloud.map((c: { sortOrder: number }) => c.sortOrder)).size).toBe(3);
    expect(await sides.store.query(list)).toEqual(cloud);
  });

  it('carries expense subcategories and credit sales both ways', async () => {
    // The owner sets up a subcategory from home; the shop books against it.
    const [category] = await sides.cloud.query(
      `INSERT INTO expense_categories ("storeId", name) VALUES ($1, 'Kitchen') RETURNING id`,
      [seed.storeId],
    );
    const [sub] = await sides.cloud.query(
      `INSERT INTO expense_subcategories ("storeId", "categoryId", name) VALUES ($1, $2, 'Gas') RETURNING id`,
      [seed.storeId, category.id],
    );
    await sides.sync();
    expect(await one('store', `SELECT name FROM expense_subcategories WHERE id = $1`, [sub.id])).toEqual({ name: 'Gas' });

    await sides.store.query(
      `INSERT INTO expenses ("storeId", "categoryId", "subcategoryId", title, amount, "expenseDate")
       VALUES ($1, $2, $3, 'Cylinder', 3200, '2026-11-05')`,
      [seed.storeId, category.id, sub.id],
    );
    // A sale put on the customer's tab at the till.
    await sides.store.query(
      `UPDATE orders SET "creditedAt" = now(), "creditedById" = $1 WHERE "orderNumber" = 'ORD-SHOP-1'`,
      [seed.waiterId],
    );
    await sides.sync();

    expect(await one('cloud', `SELECT title, "subcategoryId"::text AS sub FROM expenses`)).toEqual({ title: 'Cylinder', sub: sub.id });
    expect(
      await one('cloud', `SELECT "creditedById"::text AS by, "creditedAt" IS NOT NULL AS credited FROM orders WHERE "orderNumber" = 'ORD-SHOP-1'`),
    ).toEqual({ by: seed.waiterId, credited: true });
  });

  it('carries the tip switches down and recorded tips up', async () => {
    // The owner turns tips on from home.
    await sides.cloud.query(
      `UPDATE stores SET "tipsCashEnabled" = true, "tipsCardEnabled" = true, "tipsPaidFromCash" = true WHERE id = $1`,
      [seed.storeId],
    );
    await sides.sync();
    expect(
      await one(
        'store',
        `SELECT "tipsCashEnabled" AS cash, "tipsCardEnabled" AS card, "tipsOnlineEnabled" AS online,
                "tipsPaidFromCash" AS "fromCash" FROM stores`,
      ),
    ).toEqual({ cash: true, card: true, online: false, fromCash: true });

    // The till takes a tip with a payment, and closes the drawer it landed in.
    await sides.store.query(
      `UPDATE orders SET "tipAmount" = 150, "tipMethod" = 'card' WHERE "orderNumber" = 'ORD-SHOP-1'`,
    );
    const breakdown = [{ orderType: 'dine_in', method: 'card', amount: 150 }];
    await sides.store.query(
      `INSERT INTO cashier_shifts ("storeId", "userId", status, "openedAt", "openingFloat", "closedAt",
         "cashTips", "cardTips", "onlineTips", "tipsFromDrawer", "tipBreakdown", "expectedCash")
       VALUES ($1, $2, 'closed', now(), 1000, now(), 0, 150, 0, 150, $3::jsonb, 850)`,
      [seed.storeId, seed.waiterId, JSON.stringify(breakdown)],
    );
    await sides.sync();

    expect(
      await one(
        'cloud',
        `SELECT "tipAmount"::float AS tip, "tipMethod" AS method, total::float AS total
           FROM orders WHERE "orderNumber" = 'ORD-SHOP-1'`,
      ),
    ).toEqual({ tip: 150, method: 'card', total: 900 });
    expect(
      await one(
        'cloud',
        `SELECT "cardTips"::float AS card, "tipsFromDrawer"::float AS "fromDrawer",
                "expectedCash"::float AS expected, "tipBreakdown" AS breakdown FROM cashier_shifts`,
      ),
    ).toEqual({ card: 150, fromDrawer: 150, expected: 850, breakdown });
  });

  it('stops being the writer after a failover', async () => {
    await sides.servers.failover(seed.storeId, serverId);
    await sides.sync();

    expect((await sides.storeSync.state()).writable).toBe(false);
    await expect(
      sides.store.query(
        `INSERT INTO orders ("storeId", "orderNumber", "createdById", subtotal, total) VALUES ($1, 'ORD-LATE', $2, 0, 0)`,
        [seed.storeId, seed.waiterId],
      ),
    ).rejects.toThrow(/TNT_STORE_SERVER_READ_ONLY/);
  });
});
