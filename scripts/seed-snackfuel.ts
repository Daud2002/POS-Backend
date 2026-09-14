/**
 * Seeds the real Snack Fuel menu.
 *
 *   npm run db:seed-snackfuel
 *
 * DESTRUCTIVE for this store only: removes its existing categories, products
 * and orders before loading the menu. Every other store is untouched. For a
 * store that already has the menu and must keep its orders, use
 * `npm run db:sync-snackfuel` instead.
 *
 * The menu itself — names, prices, icons and the order the till shows them
 * in — lives in ./snackfuel-menu.ts. Cost prices are seeded at COST_RATIO of
 * the selling price: the printed menu carries no cost data, so this is a
 * placeholder for the owner dashboard, not real costing.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { COST_RATIO, MENU, SNACKFUEL_STORE_ID, TOTAL_ITEMS, round2 } from './snackfuel-menu';

dotenv.config();

const STORE_ID = SNACKFUEL_STORE_ID;

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'postgres',
    entities: [path.join(__dirname, '../src/**/*.entity{.ts,.js}')],
    synchronize: false,
  });

  await dataSource.initialize();

  const store = await dataSource.query(
    'SELECT id, name, "accountType" FROM stores WHERE id = $1',
    [STORE_ID],
  );
  if (!store.length) {
    throw new Error(`Store ${STORE_ID} not found`);
  }
  if (store[0].accountType !== 'restaurant') {
    throw new Error(`Store ${store[0].name} is not a restaurant account`);
  }

  console.log(`🍔 Seeding menu for ${store[0].name}\n`);


  // One transaction: a partial menu is worse than no menu.
  await dataSource.transaction(async (manager) => {
    // --- clear this store's existing menu and order history ---
    // order_items must go first: it has FKs onto both orders and products, so
    // the products cannot be removed while any line still references them.
    const [{ count: itemCount }] = await manager.query(
      `SELECT count(*)::int AS count FROM order_items
        WHERE "orderId" IN (SELECT id FROM orders WHERE "storeId" = $1)`,
      [STORE_ID],
    );
    await manager.query(
      `DELETE FROM order_items
        WHERE "orderId" IN (SELECT id FROM orders WHERE "storeId" = $1)`,
      [STORE_ID],
    );

    // Tables point at a live order; clear that before the orders vanish or the
    // grid would show a table reserved by an order that no longer exists.
    await manager.query(
      `UPDATE restaurant_tables
          SET status = 'free', "currentOrderId" = NULL
        WHERE "storeId" = $1`,
      [STORE_ID],
    );

    const orders = await manager.query('DELETE FROM orders WHERE "storeId" = $1', [STORE_ID]);
    const products = await manager.query('DELETE FROM products WHERE "storeId" = $1', [STORE_ID]);
    const categories = await manager.query('DELETE FROM categories WHERE "storeId" = $1', [STORE_ID]);

    // Restart order numbering, so the first real order is #1.
    await manager.query('UPDATE stores SET "orderSequence" = 0 WHERE id = $1', [STORE_ID]);

    console.log('🗑  removed old data');
    console.log(`   order items  ${itemCount}`);
    console.log(`   orders       ${orders[1] ?? 0}`);
    console.log(`   products     ${products[1] ?? 0}`);
    console.log(`   categories   ${categories[1] ?? 0}`);
    console.log('   order numbering reset to start at #1\n');

    // --- insert the menu, numbered in the order it is printed ---
    // sortOrder is store-wide and unique per table: categories 1..N,
    // products 1..M straight through, so the till shows exactly this order.
    let productSort = 0;
    for (const [groupIndex, group] of MENU.entries()) {
      const [category] = await manager.query(
        `INSERT INTO categories ("storeId", name, description, image, "sortOrder", "isActive")
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [STORE_ID, group.category, group.description, group.icon, groupIndex + 1],
      );

      for (const item of group.items) {
        productSort += 1;
        await manager.query(
          `INSERT INTO products
             ("storeId", "categoryId", name, description, price, "costPrice", image, "sortOrder", stock, "isActive")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, true)`,
          [
            STORE_ID,
            category.id,
            item.name,
            item.description ?? null,
            item.price,
            // Placeholder costing: the menu carries no cost data.
            round2(item.price * COST_RATIO),
            item.icon,
            productSort,
            // Restaurant products do not track stock.
          ],
        );
      }

      console.log(`✅ ${group.icon} ${group.category.padEnd(22)} ${String(group.items.length).padStart(3)} items`);
    }
  });

  console.log(`\n✨ Done — ${MENU.length} categories, ${TOTAL_ITEMS} products, icons and sort order set.`);
  const pct = (n: number) => Math.round(n * 100);
  console.log(`   Cost price seeded at ${pct(COST_RATIO)}% of selling price (${pct(1 - COST_RATIO)}% margin).`);

  await dataSource.destroy();
}

main().catch((error) => {
  console.error('Seeding failed:', error.message);
  process.exit(1);
});
