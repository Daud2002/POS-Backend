/**
 * Wipes Snack Fuel's OPERATIONAL data so the restaurant starts from zero,
 * while keeping everything that took effort to configure.
 *
 *   npm run db:clear-snackfuel                 # dry run: prints counts, writes nothing
 *   npm run db:clear-snackfuel -- --apply      # deletes
 *   npm run db:clear-snackfuel -- --store=<uuid>
 *   npm run db:clear-snackfuel -- --keep-expenses    # leave the expense ledger alone
 *   npm run db:clear-snackfuel -- --keep-inventory   # leave ingredients and recipes alone
 *   npm run db:clear-snackfuel -- --keep-customers   # leave the customer phone book alone
 *   npm run db:clear-snackfuel -- --only-expenses    # ONLY the expense ledger, nothing else
 *
 * DELETED, this store only:
 *   orders, order_items, order_events, cashier_shifts, inventory_movements;
 *   plus customers unless --keep-customers, expenses unless --keep-expenses,
 *   and product_ingredients + inventory_items unless --keep-inventory
 *   (stock-in/consumption history goes either way; the items keep their
 *   current quantities).
 * RESET, rows kept:
 *   stores.orderSequence -> 0 (next order prints as #1),
 *   restaurant_tables    -> free, no current order.
 * KEPT untouched:
 *   the store row, users, employee_details, refresh_tokens, categories,
 *   products, restaurant_tables, expense_categories.
 *
 * Customers: rows filed under this store, plus legacy rows with a NULL
 * storeId that are only reachable through this store's orders. A customer
 * still referenced by another store's order is skipped and reported, since
 * orders.customerId is a foreign key.
 *
 * Before anything is deleted in --apply mode, every doomed row is written to
 * backups/clear-<store>-<timestamp>.json so a mistake can be put back by hand.
 * Every other store is untouched: each statement is scoped by storeId.
 */
import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { SNACKFUEL_STORE_ID } from './snackfuel-menu';

dotenv.config();

const APPLY = process.argv.includes('--apply');
/** The ledger is bookkeeping, not till activity; an owner may want it to survive a reset. */
const KEEP_EXPENSES = process.argv.includes('--keep-expenses');
/** Ingredients and recipes are configuration an owner typed in by hand. */
const KEEP_INVENTORY = process.argv.includes('--keep-inventory');
/** The phone book of delivery customers, which some owners want to outlive their orders. */
const KEEP_CUSTOMERS = process.argv.includes('--keep-customers');
/**
 * Only the expense ledger, nothing else — for the case where a wipe was run
 * with --keep-expenses and the owner then changed their mind. Re-running the
 * full wipe would also take any orders punched since, which this must not.
 */
const ONLY_EXPENSES = process.argv.includes('--only-expenses');
if (ONLY_EXPENSES && KEEP_EXPENSES) {
  console.error('--only-expenses and --keep-expenses contradict each other');
  process.exit(1);
}
const STORE_ID =
  process.argv.find((a) => a.startsWith('--store='))?.slice('--store='.length) ??
  SNACKFUEL_STORE_ID;

const BACKUP_DIR = path.join(__dirname, '../backups');

/** Row counts for the summary, keyed by what the till would call them. */
interface Plan {
  orders: number;
  orderItems: number;
  orderEvents: number;
  cashierShifts: number;
  expenses: number;
  inventoryMovements: number;
  productIngredients: number;
  inventoryItems: number;
  customersScoped: number;
  customersLegacy: number;
  customersSkipped: number;
  tablesReserved: number;
  orderSequence: number;
}

/** postgres DELETE/UPDATE via manager.query() returns [rows, affected]. */
async function run(manager: EntityManager, sql: string, params: unknown[]): Promise<number> {
  const result = await manager.query(sql, params);
  return Array.isArray(result) ? (result[1] ?? 0) : 0;
}

/** Everything about to be removed, fetched with the same predicates the deletes use. */
async function snapshot(manager: EntityManager) {
  const q = (sql: string) => manager.query(sql, [STORE_ID]);
  /** Everything other than the ledger is out of scope under --only-expenses. */
  const unless = (skip: boolean, sql: string) => (skip ? Promise.resolve([]) : q(sql));

  const orders = await unless(ONLY_EXPENSES, 'SELECT * FROM orders WHERE "storeId" = $1');
  const orderItems = await unless(
    ONLY_EXPENSES,
    'SELECT * FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "storeId" = $1)',
  );
  const orderEvents = await unless(ONLY_EXPENSES, 'SELECT * FROM order_events WHERE "storeId" = $1');
  const cashierShifts = await unless(ONLY_EXPENSES, 'SELECT * FROM cashier_shifts WHERE "storeId" = $1');
  const expenses = await unless(KEEP_EXPENSES, 'SELECT * FROM expenses WHERE "storeId" = $1');
  const inventoryMovements = await unless(
    ONLY_EXPENSES,
    'SELECT * FROM inventory_movements WHERE "storeId" = $1',
  );
  const inventoryItems = await unless(
    KEEP_INVENTORY || ONLY_EXPENSES,
    'SELECT * FROM inventory_items WHERE "storeId" = $1',
  );
  const productIngredients = await unless(
    KEEP_INVENTORY || ONLY_EXPENSES,
    `SELECT * FROM product_ingredients
      WHERE "inventoryItemId" IN (SELECT id FROM inventory_items WHERE "storeId" = $1)
         OR "productId"       IN (SELECT id FROM products        WHERE "storeId" = $1)`,
  );

  // Deletable customers: filed under this store, or legacy (NULL storeId) but
  // only ever used by this store's orders. Anyone another store's order still
  // points at must stay, or the FK on orders.customerId fails the transaction.
  const customersScoped = await unless(
    ONLY_EXPENSES,
    `SELECT c.* FROM customers c
      WHERE c."storeId" = $1
        AND NOT EXISTS (
          SELECT 1 FROM orders o
           WHERE o."customerId" = c.id AND o."storeId" IS DISTINCT FROM $1::uuid)`,
  );
  const customersLegacy = await unless(
    ONLY_EXPENSES,
    `SELECT DISTINCT c.* FROM customers c
       JOIN orders o ON o."customerId" = c.id AND o."storeId" = $1
      WHERE c."storeId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM orders o2
           WHERE o2."customerId" = c.id AND o2."storeId" IS DISTINCT FROM $1::uuid)`,
  );
  const [{ count: customersSkipped }] = ONLY_EXPENSES
    ? [{ count: 0 }]
    : await q(
        `SELECT count(DISTINCT c.id)::int AS count FROM customers c
           JOIN orders o ON o."customerId" = c.id AND o."storeId" = $1
          WHERE EXISTS (
              SELECT 1 FROM orders o2
               WHERE o2."customerId" = c.id AND o2."storeId" IS DISTINCT FROM $1::uuid)`,
      );

  const tables = await unless(ONLY_EXPENSES, 'SELECT * FROM restaurant_tables WHERE "storeId" = $1');
  const [{ orderSequence }] = ONLY_EXPENSES
    ? [{ orderSequence: 0 }]
    : await q('SELECT "orderSequence" FROM stores WHERE id = $1');

  const plan: Plan = {
    orders: orders.length,
    orderItems: orderItems.length,
    orderEvents: orderEvents.length,
    cashierShifts: cashierShifts.length,
    expenses: expenses.length,
    inventoryMovements: inventoryMovements.length,
    productIngredients: productIngredients.length,
    inventoryItems: inventoryItems.length,
    customersScoped: customersScoped.length,
    customersLegacy: customersLegacy.length,
    customersSkipped,
    tablesReserved: tables.filter((t: { status: string }) => t.status !== 'free').length,
    orderSequence,
  };

  const customerIds: string[] = KEEP_CUSTOMERS
    ? []
    : [...customersScoped, ...customersLegacy].map((c: { id: string }) => c.id);

  return {
    plan,
    customerIds,
    rows: {
      orders,
      order_items: orderItems,
      order_events: orderEvents,
      cashier_shifts: cashierShifts,
      expenses,
      inventory_movements: inventoryMovements,
      product_ingredients: productIngredients,
      inventory_items: inventoryItems,
      customers: [...customersScoped, ...customersLegacy],
      // Not deleted, but reset: kept so the pre-wipe table state is on record.
      restaurant_tables_before: tables,
    },
  };
}

function printPlan(plan: Plan, verb: string) {
  const line = (label: string, n: number) =>
    console.log(`   ${label.padEnd(22)} ${String(n).padStart(6)}`);
  const kept = (label: string) => console.log(`   ${label.padEnd(22)}   kept`);
  console.log(`${verb}:`);
  if (ONLY_EXPENSES) {
    line('expenses', plan.expenses);
    console.log('   (everything else untouched: --only-expenses)\n');
    return;
  }
  line('orders', plan.orders);
  line('order items', plan.orderItems);
  line('order events', plan.orderEvents);
  line('cashier shifts', plan.cashierShifts);
  if (KEEP_EXPENSES) kept('expenses'); else line('expenses', plan.expenses);
  line('inventory movements', plan.inventoryMovements);
  if (KEEP_INVENTORY) {
    kept('recipes (ingredients)');
    kept('inventory items');
  } else {
    line('recipes (ingredients)', plan.productIngredients);
    line('inventory items', plan.inventoryItems);
  }
  if (KEEP_CUSTOMERS) {
    kept('customers');
  } else {
    line('customers (this store)', plan.customersScoped);
    line('customers (legacy)', plan.customersLegacy);
  }
  if (!KEEP_CUSTOMERS && plan.customersSkipped > 0) {
    line('customers SKIPPED', plan.customersSkipped);
    console.log('   (still referenced by another store; left in place)');
  }
  console.log('');
  console.log(`   tables to free           ${String(plan.tablesReserved).padStart(6)}`);
  console.log(`   order counter now at     ${String(plan.orderSequence).padStart(6)}  -> 0`);
  console.log('');
}

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'postgres',
    synchronize: false,
  });

  await dataSource.initialize();

  try {
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

    const keeping = ONLY_EXPENSES
      ? 'everything except expenses'
      : [
          KEEP_EXPENSES && 'expenses',
          KEEP_INVENTORY && 'inventory + recipes',
          KEEP_CUSTOMERS && 'customers',
        ]
          .filter(Boolean)
          .join(', ');
    console.log(
      `🧹 ${APPLY ? 'CLEARING' : 'Dry run for'} ${store[0].name} (${STORE_ID})` +
        ` on ${process.env.DATABASE_HOST || 'localhost'}` +
        (keeping ? `\n   keeping: ${keeping}` : '') +
        '\n',
    );

    const { plan, customerIds, rows } = await dataSource.transaction((m) => snapshot(m));

    if (!APPLY) {
      printPlan(plan, 'Would delete');
      console.log('Nothing written. Re-run with --apply to delete.');
      return;
    }

    // Backup FIRST, outside the transaction, so it exists even if the wipe fails.
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `clear-${STORE_ID.slice(0, 8)}-${stamp}.json`);
    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        { storeId: STORE_ID, storeName: store[0].name, takenAt: new Date().toISOString(), plan, rows },
        null,
        2,
      ),
    );
    console.log(`💾 backup written to ${backupFile}\n`);

    // One transaction: a half-cleared restaurant is worse than an uncleared one.
    // Order is FK-safe: children before parents, orders before the customers
    // and shifts they point at, recipes before the ingredients they name.
    const done = await dataSource.transaction(async (m) => {
      const s = [STORE_ID];
      const out: Record<string, number> = {};

      if (ONLY_EXPENSES) {
        out.expenses = await run(m, 'DELETE FROM expenses WHERE "storeId" = $1', s);
        return out;
      }

      out.orderEvents = await run(m, 'DELETE FROM order_events WHERE "storeId" = $1', s);
      out.orderItems = await run(
        m,
        'DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "storeId" = $1)',
        s,
      );
      // Free tables before their live orders vanish, or the grid shows a table
      // reserved by an order that no longer exists.
      out.tablesFreed = await run(
        m,
        `UPDATE restaurant_tables SET status = 'free', "currentOrderId" = NULL
          WHERE "storeId" = $1 AND (status <> 'free' OR "currentOrderId" IS NOT NULL)`,
        s,
      );
      out.orders = await run(m, 'DELETE FROM orders WHERE "storeId" = $1', s);
      out.cashierShifts = await run(m, 'DELETE FROM cashier_shifts WHERE "storeId" = $1', s);
      out.expenses = KEEP_EXPENSES
        ? 0
        : await run(m, 'DELETE FROM expenses WHERE "storeId" = $1', s);
      out.inventoryMovements = await run(
        m,
        'DELETE FROM inventory_movements WHERE "storeId" = $1',
        s,
      );
      out.productIngredients = KEEP_INVENTORY
        ? 0
        : await run(
            m,
            `DELETE FROM product_ingredients
              WHERE "inventoryItemId" IN (SELECT id FROM inventory_items WHERE "storeId" = $1)
                 OR "productId"       IN (SELECT id FROM products        WHERE "storeId" = $1)`,
            s,
          );
      out.inventoryItems = KEEP_INVENTORY
        ? 0
        : await run(m, 'DELETE FROM inventory_items WHERE "storeId" = $1', s);
      out.customers = customerIds.length
        ? await run(m, 'DELETE FROM customers WHERE id = ANY($1::uuid[])', [customerIds])
        : 0;
      out.orderSequenceReset = await run(
        m,
        'UPDATE stores SET "orderSequence" = 0 WHERE id = $1',
        s,
      );

      return out;
    });

    const line = (label: string, n: number) =>
      console.log(`   ${label.padEnd(22)} ${String(n).padStart(6)}`);
    console.log('Deleted:');
    if (ONLY_EXPENSES) {
      line('expenses', done.expenses);
      console.log(`\n✨ ${store[0].name}'s expense ledger is empty. Nothing else was touched.`);
      return;
    }
    line('orders', done.orders);
    line('order items', done.orderItems);
    line('order events', done.orderEvents);
    line('cashier shifts', done.cashierShifts);
    if (!KEEP_EXPENSES) line('expenses', done.expenses);
    line('inventory movements', done.inventoryMovements);
    if (!KEEP_INVENTORY) {
      line('recipes (ingredients)', done.productIngredients);
      line('inventory items', done.inventoryItems);
    }
    if (KEEP_CUSTOMERS) {
      console.log(`   ${'customers'.padEnd(22)}   kept`);
    } else {
      line('customers', done.customers);
      if (plan.customersSkipped > 0) line('customers SKIPPED', plan.customersSkipped);
    }
    console.log('');
    line('tables freed', done.tablesFreed);
    console.log(`\n✨ ${store[0].name} is back to a clean start. Order counter reset to 0.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Clear failed:', error.message);
  process.exit(1);
});
