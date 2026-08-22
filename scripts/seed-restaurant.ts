/**
 * Seeds a complete restaurant tenant so the waiter -> kitchen -> cashier flow
 * can be exercised immediately.
 *
 *   npm run db:seed-restaurant
 *
 * Idempotent: re-running only fills in what is missing. It never touches the
 * general-account demo store created by db:seed-demo.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const OWNER = { email: 'chef@tapntrade.store', password: 'owner123', name: 'Zaitoon Owner' };
const STAFF = [
  { email: 'waiter@tapntrade.store', password: 'waiter123', name: 'Ali Waiter', designation: 'waiter', employeeId: 'RW-001' },
  { email: 'waiter2@tapntrade.store', password: 'waiter123', name: 'Sara Waiter', designation: 'waiter', employeeId: 'RW-002' },
  { email: 'kitchen@tapntrade.store', password: 'kitchen123', name: 'Head Chef', designation: 'kitchen', employeeId: 'RK-001' },
  { email: 'cash@tapntrade.store', password: 'cashier123', name: 'Front Desk', designation: 'cashier', employeeId: 'RC-001' },
];

const CATEGORIES = [
  { name: 'Starters', description: 'Soups, salads and small plates' },
  { name: 'Main Course', description: 'Rice, karahi and grilled dishes' },
  { name: 'Breads', description: 'Tandoor breads, made to order' },
  { name: 'Drinks', description: 'Soft drinks, lassi and tea' },
];

/** price / cost pairs chosen so the profit report shows a realistic margin. */
const PRODUCTS: Array<[string, string, number, number]> = [
  ['Starters', 'Chicken Corn Soup', 320, 140],
  ['Starters', 'Russian Salad', 280, 120],
  ['Main Course', 'Chicken Biryani', 550, 300],
  ['Main Course', 'Mutton Karahi (1kg)', 2400, 1650],
  ['Main Course', 'Chicken Handi', 1250, 780],
  ['Main Course', 'Seekh Kebab (6pc)', 900, 520],
  ['Breads', 'Garlic Naan', 90, 35],
  ['Breads', 'Roghni Naan', 110, 45],
  ['Drinks', 'Fresh Lime', 180, 60],
  ['Drinks', 'Sweet Lassi', 250, 95],
];

const TABLES = ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Patio 1', 'Patio 2'];

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
  console.log('🍽  Seeding restaurant tenant…\n');

  const users = dataSource.getRepository('User');
  const stores = dataSource.getRepository('Store');
  const employees = dataSource.getRepository('Employee');
  const categories = dataSource.getRepository('Category');
  const products = dataSource.getRepository('Product');
  const tables = dataSource.getRepository('RestaurantTable');

  // Owner
  let owner: any = await users.findOne({ where: { email: OWNER.email } });
  if (!owner) {
    owner = await users.save(
      users.create({
        email: OWNER.email,
        passwordHash: await bcrypt.hash(OWNER.password, 10),
        name: OWNER.name,
        role: 'store_owner',
        isActive: true,
      }),
    );
    console.log(`✅ owner        ${OWNER.email}`);
  } else {
    // Self-heal: a wrong role here sends the owner to the wrong screen.
    if (owner.role !== 'store_owner') {
      owner.role = 'store_owner';
      await users.save(owner);
    }
    console.log(`⏭️  owner        ${OWNER.email} (exists)`);
  }

  // Store
  let store: any = await stores.findOne({ where: { userId: owner.id } });
  if (!store) {
    store = await stores.save(
      stores.create({
        userId: owner.id,
        name: 'Zaitoon Grill',
        accountType: 'restaurant',
        plan: 'pro',
        currency: 'PKR',
        address: 'Gulberg III, Lahore',
        phone: '+92 300 1234567',
        email: OWNER.email,
        printerConfig: 'BP-80',
      }),
    );
    console.log(`✅ store        ${store.name} (restaurant)`);
  } else {
    if (store.accountType !== 'restaurant') {
      store.accountType = 'restaurant';
      await stores.save(store);
    }
    console.log(`⏭️  store        ${store.name} (exists)`);
  }

  // Staff
  let staffCreated = 0;
  for (const person of STAFF) {
    let user: any = await users.findOne({ where: { email: person.email } });
    if (!user) {
      user = await users.save(
        users.create({
          email: person.email,
          passwordHash: await bcrypt.hash(person.password, 10),
          name: person.name,
          role: 'employee',
          isActive: true,
        }),
      );
    }
    const existing = await employees.findOne({ where: { userId: user.id } });
    if (!existing) {
      await employees.save(
        employees.create({
          storeId: store.id,
          userId: user.id,
          employeeId: person.employeeId,
          name: person.name,
          email: person.email,
          designation: person.designation,
        }),
      );
      staffCreated += 1;
    }
  }
  console.log(`✅ staff        ${STAFF.length} (${staffCreated} new)`);

  // Categories
  const categoryByName = new Map<string, any>();
  for (const entry of CATEGORIES) {
    let category = await categories.findOne({ where: { storeId: store.id, name: entry.name } });
    if (!category) {
      category = await categories.save(
        categories.create({ storeId: store.id, name: entry.name, description: entry.description }),
      );
    }
    categoryByName.set(entry.name, category);
  }
  console.log(`✅ categories   ${CATEGORIES.length}`);

  // Dishes. Restaurant products carry no stock — inventory is a v2 module —
  // but costPrice is set so the owner dashboard can show real profit.
  let productsCreated = 0;
  for (const [categoryName, name, price, cost] of PRODUCTS) {
    const existing = await products.findOne({ where: { storeId: store.id, name } });
    if (!existing) {
      await products.save(
        products.create({
          storeId: store.id,
          categoryId: categoryByName.get(categoryName)?.id,
          name,
          price,
          costPrice: cost,
          stock: 0,
          isActive: true,
        }),
      );
      productsCreated += 1;
    }
  }
  console.log(`✅ dishes       ${PRODUCTS.length} (${productsCreated} new)`);

  // Tables
  let tablesCreated = 0;
  for (const name of TABLES) {
    const existing = await tables.findOne({ where: { storeId: store.id, name } });
    if (!existing) {
      await tables.save(tables.create({ storeId: store.id, name, status: 'free', isActive: true }));
      tablesCreated += 1;
    }
  }
  console.log(`✅ tables       ${TABLES.length} (${tablesCreated} new)`);

  console.log('\n✨ Done. Sign in with:\n');
  console.log(`   Owner    ${OWNER.email}  /  ${OWNER.password}`);
  for (const person of STAFF) {
    console.log(`   ${person.designation.padEnd(8)} ${person.email}  /  ${person.password}`);
  }
  console.log('\n   Try it: sign in as a waiter, punch an order for Table 1,');
  console.log('   and watch it appear on the kitchen screen without refreshing.\n');

  await dataSource.destroy();
}

main().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
