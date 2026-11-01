import { DataSource } from 'typeorm';
import { freshDatabase } from '../support/pg';

/**
 * The capture triggers, exercised directly with SQL: what each kind of write
 * leaves in sync_meta and sync_counter_deltas, and the single-writer guard.
 */
describe('change capture', () => {
  let db: DataSource;
  let storeId: string;

  beforeAll(async () => {
    db = new DataSource(await freshDatabase('cloud', 'sync_capture'));
    await db.initialize();
    await db.runMigrations();
  });

  afterAll(() => db.destroy());

  beforeEach(async () => {
    const [store] = await db.query(`INSERT INTO stores (name) VALUES ('Capture kitchen') RETURNING id`);
    storeId = store.id;
  });

  const meta = (tbl: string, id: string) =>
    db.query(`SELECT grp, origin, deleted FROM sync_meta WHERE tbl = $1 AND id = $2 ORDER BY grp`, [tbl, id]);
  const seqOf = async (tbl: string, id: string, grp: string) =>
    (await db.query(`SELECT seq FROM sync_meta WHERE tbl = $1 AND id = $2 AND grp = $3`, [tbl, id, grp]))[0]?.seq;
  const deltas = (id: string) =>
    db.query(`SELECT col, delta::float AS delta FROM sync_counter_deltas WHERE row_id = $1 ORDER BY seq`, [id]);

  async function product(stock = 10) {
    const [row] = await db.query(
      `INSERT INTO products ("storeId", name, price, stock) VALUES ($1, 'Zinger', 450, $2) RETURNING id`,
      [storeId, stock],
    );
    return row.id as string;
  }

  it('stamps every group of a new row and records its opening stock as a delta', async () => {
    const id = await product(10);

    expect(await meta('products', id)).toEqual([
      { grp: 'recipe', origin: 'cloud', deleted: false },
      { grp: 'row', origin: 'cloud', deleted: false },
    ]);
    expect(await deltas(id)).toEqual([{ col: 'stock', delta: 10 }]);
  });

  it('re-stamps only the group whose columns changed', async () => {
    const id = await product();
    const rowBefore = await seqOf('products', id, 'row');
    const recipeBefore = await seqOf('products', id, 'recipe');

    await db.query(`UPDATE products SET price = 500 WHERE id = $1`, [id]);

    expect(Number(await seqOf('products', id, 'row'))).toBeGreaterThan(Number(rowBefore));
    expect(await seqOf('products', id, 'recipe')).toBe(recipeBefore);
  });

  it('records stock changes as deltas, however they are written', async () => {
    const id = await product(10);

    await db.query(`UPDATE products SET stock = stock - 3 WHERE id = $1`, [id]);
    await db.query(`UPDATE products SET stock = 20 WHERE id = $1`, [id]);

    expect(await deltas(id)).toEqual([
      { col: 'stock', delta: 10 },
      { col: 'stock', delta: -3 },
      { col: 'stock', delta: 13 },
    ]);
    // A stock-only change is not a menu edit.
    const [{ count }] = await db.query(
      `SELECT count(*)::int AS count FROM sync_meta WHERE tbl = 'products' AND id = $1`,
      [id],
    );
    expect(count).toBe(2);
  });

  it('leaves a tombstone on delete', async () => {
    const id = await product();
    await db.query(`DELETE FROM products WHERE id = $1`, [id]);

    expect(await meta('products', id)).toEqual([
      { grp: 'recipe', origin: 'cloud', deleted: true },
      { grp: 'row', origin: 'cloud', deleted: true },
    ]);
  });

  it('stamps the parent when a recipe line changes', async () => {
    const id = await product();
    const [item] = await db.query(
      `INSERT INTO inventory_items ("storeId", name) VALUES ($1, 'Chicken') RETURNING id`,
      [storeId],
    );
    const before = await seqOf('products', id, 'recipe');

    await db.query(`INSERT INTO product_ingredients ("productId", "inventoryItemId", quantity) VALUES ($1, $2, 150)`, [
      id,
      item.id,
    ]);

    expect(Number(await seqOf('products', id, 'recipe'))).toBeGreaterThan(Number(before));
  });

  it('skips everything while the sync itself is applying', async () => {
    const id = await product();
    const before = await seqOf('products', id, 'row');

    await db.transaction(async (m) => {
      await m.query(`SELECT set_config('tnt.applying', 'on', true)`);
      await m.query(`UPDATE products SET price = 999, stock = 1 WHERE id = $1`, [id]);
    });

    expect(await seqOf('products', id, 'row')).toBe(before);
    expect(await deltas(id)).toHaveLength(1);
  });

  it('refuses shop-owned writes from the cloud once the store runs its own server', async () => {
    const [cashier] = await db.query(
      `INSERT INTO users (email, "passwordHash") VALUES ('cashier-' || gen_random_uuid() || '@example.com', 'x') RETURNING id`,
    );
    await db.query(`UPDATE stores SET "operationMode" = 'server' WHERE id = $1`, [storeId]);

    await expect(
      db.query(
        `INSERT INTO orders ("storeId", "orderNumber", "createdById", subtotal, total) VALUES ($1, 'ORD-1', $2, 0, 0)`,
        [storeId, cashier.id],
      ),
    ).rejects.toThrow(/TNT_STORE_SERVER_MODE/);
    await expect(db.query(`UPDATE stores SET "orderSequence" = 5 WHERE id = $1`, [storeId])).rejects.toThrow(
      /TNT_STORE_SERVER_MODE/,
    );

    // The menu is still the owner's to edit from anywhere.
    await expect(product()).resolves.toBeDefined();
  });

  it('finds an employee user’s store through the employee row', async () => {
    const [user] = await db.query(
      `INSERT INTO users (email, "passwordHash", role) VALUES ('waiter@example.com', 'x', 'employee') RETURNING id`,
    );
    // Unknown store yet: nothing to stamp.
    expect(await meta('users', user.id)).toEqual([]);

    await db.query(
      `INSERT INTO employee_details ("storeId", "userId", "employeeId", name, email) VALUES ($1, $2, 'W1', 'Waiter', 'waiter@example.com')`,
      [storeId, user.id],
    );

    expect((await meta('users', user.id)).map((m: { grp: string }) => m.grp)).toEqual([
      'identity',
      'profile',
      'status',
    ]);
  });
});
