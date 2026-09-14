import 'reflect-metadata';
// Nest loads .env through ConfigModule; a standalone script has to do it
// itself, or typeormConfig() silently falls back to localhost defaults.
import * as dotenv from 'dotenv';
dotenv.config();

import { createConnection, EntityManager } from 'typeorm';
import { typeormConfig } from '../src/database/typeorm.config';
import * as entities from '../src/entities';
import { Category, Product } from '../src/entities';
import {
  COST_RATIO,
  MENU,
  RENAMES,
  SNACKFUEL_STORE_ID,
  TOTAL_ITEMS,
  legacyName,
  round2,
  type Group,
  type Item,
} from './snackfuel-menu';

/**
 * Every entity, not just the two being written: Category and Product point at
 * Store and OrderItem, and TypeORM refuses to build metadata for half a graph.
 */
const ALL_ENTITIES = (Object.values(entities) as unknown[]).filter(
  (value) => typeof value === 'function',
) as Function[];

/**
 * Bring an EXISTING Snack Fuel store into line with the printed menu, without
 * touching its orders.
 *
 * For every category and product in ./snackfuel-menu.ts, matched by name:
 *   - sets the icon and the sort number (categories 1..N, products 1..M, in
 *     menu order — the order the till shows them in);
 *   - sets costPrice = price × COST_RATIO;
 *   - renames rows the menu now calls something else ("Tikka (Small)" →
 *     "Tikka (S)", "NR Bottle" → "NR Coke") IN PLACE, so the row and every
 *     order line that references it survive;
 *   - creates menu items the store does not have yet.
 *
 * It never changes a price and never deletes a row. Prices that differ from
 * the menu, and rows the menu does not know, are REPORTED so a human decides.
 *
 *   npm run db:sync-snackfuel                  # dry run: prints what it WOULD do
 *   npm run db:sync-snackfuel -- --apply       # writes
 *   npm run db:sync-snackfuel -- --store=<uuid>
 *
 * Safe to re-run: a second pass finds nothing left to change.
 */

const norm = (name: string) => name.trim().toLowerCase();

interface ProductPlan {
  id: string | null; // null = create
  categoryId: string;
  categoryName: string;
  currentName: string | null;
  name: string;
  price: number;
  currentPrice: number | null;
  costPrice: number;
  icon: string;
  sortOrder: number;
  description?: string;
}

interface CategoryPlan {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
}

/** Finds the row for a menu item under its current name, its old size label, or its old name. */
function findProduct(rows: Product[], item: Item): Product | undefined {
  const candidates = [item.name, legacyName(item.name)];
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    if (newName === item.name) candidates.push(oldName);
  }
  for (const candidate of candidates) {
    const hit = rows.find((p) => norm(p.name) === norm(candidate));
    if (hit) return hit;
  }
  return undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const storeArg = process.argv.find((a) => a.startsWith('--store='));
  const storeId = storeArg ? storeArg.split('=')[1] : SNACKFUEL_STORE_ID;

  // Cast: typeormConfig() is typed as Nest's option union, which createConnection
  // cannot narrow. `synchronize` off — a sync must never alter the schema.
  const connection = await createConnection({
    ...(typeormConfig() as any),
    entities: ALL_ENTITIES,
    synchronize: false,
  } as any);

  try {
    const [store] = await connection.query(
      'SELECT id, name, "accountType" FROM stores WHERE id = $1',
      [storeId],
    );
    if (!store) throw new Error(`Store ${storeId} not found`);
    if (store.accountType !== 'restaurant') {
      throw new Error(`Store ${store.name} is not a restaurant account`);
    }

    const categories = await connection.getRepository(Category).find({ where: { storeId } });
    const products = await connection.getRepository(Product).find({ where: { storeId } });

    console.log(
      `\n${apply ? '✍️  APPLYING' : '👀 DRY RUN'} — ${store.name}: ` +
        `${categories.length} categories, ${products.length} products in the database; ` +
        `menu has ${MENU.length} categories, ${TOTAL_ITEMS} products`,
    );

    // ---- plan
    const categoryPlans: CategoryPlan[] = [];
    const productPlans: ProductPlan[] = [];
    const missingCategories: string[] = [];
    const priceMismatches: Array<{ name: string; db: number; menu: number }> = [];
    const matchedCategoryIds = new Set<string>();
    const matchedProductIds = new Set<string>();

    let productSort = 0;
    MENU.forEach((group: Group, groupIndex) => {
      const category = categories.find((c) => norm(c.name) === norm(group.category));
      if (!category) {
        missingCategories.push(group.category);
        // Still consume the sort numbers so the rest of the menu keeps its place.
        productSort += group.items.length;
        return;
      }
      matchedCategoryIds.add(category.id);
      categoryPlans.push({
        id: category.id,
        name: category.name,
        icon: group.icon,
        sortOrder: groupIndex + 1,
      });

      const inCategory = products.filter((p) => p.categoryId === category.id);
      for (const item of group.items) {
        productSort += 1;
        const row = findProduct(inCategory, item);
        if (row) matchedProductIds.add(row.id);
        const currentPrice = row ? Number(row.price) : null;
        if (row && currentPrice !== item.price) {
          priceMismatches.push({ name: item.name, db: currentPrice!, menu: item.price });
        }
        productPlans.push({
          id: row?.id ?? null,
          categoryId: category.id,
          categoryName: category.name,
          currentName: row?.name ?? null,
          name: item.name,
          // Never change a price. A new row takes the menu price, obviously.
          price: row ? currentPrice! : item.price,
          currentPrice,
          costPrice: round2((row ? currentPrice! : item.price) * COST_RATIO),
          icon: item.icon,
          sortOrder: productSort,
          description: item.description,
        });
      }
    });

    const extraCategories = categories.filter((c) => !matchedCategoryIds.has(c.id));
    const extraProducts = products.filter((p) => !matchedProductIds.has(p.id));

    // ---- report
    const renames = productPlans.filter((p) => p.id && p.currentName !== p.name);
    const creates = productPlans.filter((p) => !p.id);

    console.log('\n── categories ──');
    for (const plan of categoryPlans) {
      console.log(`  #${String(plan.sortOrder).padStart(2)}  ${plan.icon}  ${plan.name}`);
    }

    console.log(`\n── products ── ${productPlans.length - creates.length} matched, ${creates.length} to create`);
    let lastCategory = '';
    for (const plan of productPlans) {
      if (plan.categoryName !== lastCategory) {
        console.log(`  ${plan.categoryName}`);
        lastCategory = plan.categoryName;
      }
      const tag = !plan.id ? '  NEW' : plan.currentName !== plan.name ? `  (was "${plan.currentName}")` : '';
      console.log(
        `    #${String(plan.sortOrder).padStart(3)}  ${plan.icon}  ${plan.name.padEnd(32)} ` +
          `${String(plan.price).padStart(5)}  cost ${String(plan.costPrice).padStart(7)}${tag}`,
      );
    }

    console.log(`\n── renamed in place ── ${renames.length}`);
    for (const plan of renames) console.log(`  "${plan.currentName}" → "${plan.name}"`);

    console.log(`\n── created ── ${creates.length}`);
    for (const plan of creates) console.log(`  ${plan.icon}  ${plan.name}  ${plan.price}`);

    console.log(`\n── price differs from the menu (NOT changed) ── ${priceMismatches.length}`);
    for (const m of priceMismatches) console.log(`  ${m.name}: db ${m.db}, menu ${m.menu}`);

    console.log(`\n── in the database but not on the menu (kept) ── ${extraCategories.length + extraProducts.length}`);
    for (const c of extraCategories) console.log(`  category  ${c.name}`);
    for (const p of extraProducts) console.log(`  product   ${p.name}`);

    if (missingCategories.length) {
      console.log(`\n── menu categories not in the database ── ${missingCategories.length}`);
      for (const name of missingCategories) console.log(`  ${name}`);
      throw new Error(
        'A menu category is missing — this does not look like the Snack Fuel store. Nothing written.',
      );
    }

    if (!apply) {
      console.log('\n👀 Dry run — nothing was written. Re-run with --apply to commit.\n');
      return;
    }

    // ---- write
    await connection.transaction(async (manager: EntityManager) => {
      // sortOrder is unique per store (partial index, NULLs exempt). Free every
      // number first so the re-numbering cannot collide with an old value.
      await manager.query('UPDATE categories SET "sortOrder" = NULL WHERE "storeId" = $1', [storeId]);
      await manager.query('UPDATE products SET "sortOrder" = NULL WHERE "storeId" = $1', [storeId]);

      for (const plan of categoryPlans) {
        await manager.query(
          'UPDATE categories SET image = $1, "sortOrder" = $2 WHERE id = $3',
          [plan.icon, plan.sortOrder, plan.id],
        );
      }

      for (const plan of productPlans) {
        if (plan.id) {
          await manager.query(
            `UPDATE products
                SET name = $1, image = $2, "sortOrder" = $3, "costPrice" = $4,
                    description = COALESCE($5, description)
              WHERE id = $6`,
            [plan.name, plan.icon, plan.sortOrder, plan.costPrice, plan.description ?? null, plan.id],
          );
        } else {
          await manager.query(
            `INSERT INTO products
               ("storeId", "categoryId", name, description, price, "costPrice", image, "sortOrder", stock, "isActive")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, true)`,
            [storeId, plan.categoryId, plan.name, plan.description ?? null, plan.price, plan.costPrice, plan.icon, plan.sortOrder],
          );
        }
      }

      // Anything the menu does not know keeps its icon and lines up after the
      // menu, in name order, so nothing is left unnumbered (unnumbered sorts last
      // and looks lost on the till).
      let nextCategory = MENU.length;
      for (const c of [...extraCategories].sort((a, b) => a.name.localeCompare(b.name))) {
        nextCategory += 1;
        await manager.query('UPDATE categories SET "sortOrder" = $1 WHERE id = $2', [nextCategory, c.id]);
      }
      let nextProduct = productSort;
      for (const p of [...extraProducts].sort((a, b) => a.name.localeCompare(b.name))) {
        nextProduct += 1;
        await manager.query('UPDATE products SET "sortOrder" = $1 WHERE id = $2', [nextProduct, p.id]);
      }
    });

    console.log(
      `\n✅ Synced ${categoryPlans.length} categories and ${productPlans.length} products ` +
        `(${renames.length} renamed, ${creates.length} created); cost set to ${Math.round(COST_RATIO * 100)}% of price.\n`,
    );
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('❌ Sync failed:', error.message);
  process.exit(1);
});
