import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
import {
  User,
  Store,
  Employee,
  Category,
  Product,
  Customer,
  Order,
  OrderItem,
} from '../src/entities';

dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Seeds a complete, self-consistent store so every mobile screen has data.
 *
 * `seed-users.ts` only creates User rows, which is not enough: `getUserWithStore`
 * resolves storeId from a Store (owner) or an Employee row (cashier), and a user
 * with no storeId lands in the app with an empty catalogue and broken reports.
 * This script creates the whole graph — owner + store + cashier + catalogue +
 * customers + order history.
 *
 * Idempotent: re-running skips anything that already exists.
 *
 *   npm run db:seed-demo
 */

const OWNER = {
  email: 'owner@tapntrade.store',
  password: 'owner123',
  name: 'Zara Malik',
};

const CASHIER = {
  email: 'cashier@tapntrade.store',
  password: 'cashier123',
  name: 'Bilal Ahmed',
};

const STORE = {
  name: 'TapnTrade Demo Mart',
  // The cosmetic `type` column is superseded by `accountType`; seeds set the
  // real field so a seeded store exercises the same path as a created one.
  accountType: 'general' as const,
  plan: 'pro',
  currency: 'PKR',
  address: '12 Jail Road, Gulberg III, Lahore',
  phone: '+92 300 1234567',
  email: 'hello@tapntrade.store',
  // Matches the Store entity default; the mobile app stores its own Bluetooth
  // binding in MMKV per device, so this only affects the web/QZ Tray path.
  printerConfig: 'BP-80',
};

const CATEGORIES = [
  { name: 'Beverages', description: 'Tea, coffee, soft drinks and juices' },
  { name: 'Snacks', description: 'Chips, biscuits and confectionery' },
  { name: 'Dairy & Bakery', description: 'Milk, yoghurt, bread and eggs' },
  { name: 'Household', description: 'Cleaning and everyday essentials' },
];

/**
 * Barcodes are real-looking EAN-13 values. To exercise the camera scanner
 * without a physical product, display one as a barcode on screen and scan that.
 */
const PRODUCTS: Array<{
  category: string;
  name: string;
  price: number;
  costPrice: number;
  stock: number;
  lowStockAlertQuantity: number;
  sku: string;
  barcode: string;
}> = [
  // Beverages
  { category: 'Beverages', name: 'Coca-Cola 1.5L', price: 220, costPrice: 178, stock: 64, lowStockAlertQuantity: 12, sku: 'BEV-COKE-15', barcode: '5449000000996' },
  { category: 'Beverages', name: 'Nestlé Fruita Vitals Mango 1L', price: 310, costPrice: 252, stock: 28, lowStockAlertQuantity: 10, sku: 'BEV-FV-MNG', barcode: '8964000201534' },
  { category: 'Beverages', name: 'Lipton Yellow Label 190g', price: 745, costPrice: 640, stock: 9, lowStockAlertQuantity: 10, sku: 'BEV-LIP-190', barcode: '8964000107461' },
  { category: 'Beverages', name: 'Nescafé Classic 100g', price: 1290, costPrice: 1105, stock: 17, lowStockAlertQuantity: 6, sku: 'BEV-NES-100', barcode: '7613036718264' },
  { category: 'Beverages', name: 'Aquafina Water 1.5L', price: 90, costPrice: 66, stock: 120, lowStockAlertQuantity: 24, sku: 'BEV-AQF-15', barcode: '8964000304518' },

  // Snacks
  { category: 'Snacks', name: 'Lays Masala 40g', price: 60, costPrice: 46, stock: 152, lowStockAlertQuantity: 30, sku: 'SNK-LAY-MAS', barcode: '8964000251249' },
  { category: 'Snacks', name: 'Oreo Original 137g', price: 195, costPrice: 158, stock: 41, lowStockAlertQuantity: 12, sku: 'SNK-ORE-137', barcode: '7622300336738' },
  { category: 'Snacks', name: 'Peek Freans Sooper 6-pack', price: 150, costPrice: 118, stock: 73, lowStockAlertQuantity: 20, sku: 'SNK-SOO-6', barcode: '8964000158845' },
  { category: 'Snacks', name: 'Dairy Milk 65g', price: 340, costPrice: 285, stock: 5, lowStockAlertQuantity: 10, sku: 'SNK-DM-65', barcode: '7622210951045' },
  { category: 'Snacks', name: 'Kurkure Chatpata 62g', price: 70, costPrice: 53, stock: 88, lowStockAlertQuantity: 20, sku: 'SNK-KUR-62', barcode: '8964000253410' },

  // Dairy & Bakery
  { category: 'Dairy & Bakery', name: 'Olpers Milk 1L', price: 300, costPrice: 268, stock: 46, lowStockAlertQuantity: 15, sku: 'DRY-OLP-1L', barcode: '8964000101025' },
  { category: 'Dairy & Bakery', name: 'Nurpur Butter 200g', price: 620, costPrice: 540, stock: 22, lowStockAlertQuantity: 8, sku: 'DRY-NUR-200', barcode: '8964000110430' },
  { category: 'Dairy & Bakery', name: 'Dawn Bread Large', price: 210, costPrice: 172, stock: 3, lowStockAlertQuantity: 10, sku: 'BAK-DWN-LG', barcode: '8964000127018' },
  { category: 'Dairy & Bakery', name: 'Farm Eggs Dozen', price: 380, costPrice: 330, stock: 34, lowStockAlertQuantity: 12, sku: 'DRY-EGG-12', barcode: '8964000133019' },

  // Household
  { category: 'Household', name: 'Surf Excel 1kg', price: 780, costPrice: 672, stock: 26, lowStockAlertQuantity: 8, sku: 'HHD-SRF-1K', barcode: '8964000144022' },
  { category: 'Household', name: 'Sufi Soap 130g', price: 145, costPrice: 112, stock: 97, lowStockAlertQuantity: 25, sku: 'HHD-SUF-130', barcode: '8964000155028' },
  { category: 'Household', name: 'Harpic 500ml', price: 465, costPrice: 398, stock: 7, lowStockAlertQuantity: 10, sku: 'HHD-HRP-500', barcode: '8964000166035' },
  { category: 'Household', name: 'Rose Petal Tissues 150s', price: 260, costPrice: 205, stock: 58, lowStockAlertQuantity: 15, sku: 'HHD-RPT-150', barcode: '8964000177042' },
];

const CUSTOMERS = [
  { name: 'Ayesha Siddiqui', email: 'ayesha.s@example.com', phone: '+92 301 4455661', address: 'House 4, Street 11, DHA Phase 5', city: 'Lahore' },
  { name: 'Hamza Tariq', email: 'hamza.t@example.com', phone: '+92 321 7788992', address: 'Flat 3B, Askari Heights', city: 'Lahore' },
  { name: 'Fatima Noor', email: 'fatima.n@example.com', phone: '+92 333 1122334', address: '77 Model Town Link Road', city: 'Lahore' },
  { name: 'Usman Raza', email: 'usman.r@example.com', phone: '+92 345 9988776', address: 'Shop 12, Anarkali Bazaar', city: 'Lahore' },
  { name: 'Sana Iqbal', email: 'sana.i@example.com', phone: '+92 302 5566778', address: '9 Cavalry Ground', city: 'Lahore' },
];

/**
 * Order history spread over the last 30 days so Dashboard and Reports have a
 * trend to draw rather than a single spike. `daysAgo` is turned into a real
 * timestamp with a follow-up UPDATE, because @CreateDateColumn overwrites
 * whatever we pass on insert.
 *
 * A few rows are deliberately left `unpaid` — only a store_owner can settle
 * them, which is the role gate worth exercising on the Orders screen.
 */
const ORDERS: Array<{
  daysAgo: number;
  customer: string | null;
  status: 'paid' | 'unpaid' | 'completed' | 'cancelled';
  paymentMethod: 'cash' | 'card' | 'online';
  discount: number;
  by: 'owner' | 'cashier';
  items: Array<{ product: string; quantity: number }>;
}> = [
  { daysAgo: 28, customer: 'Ayesha Siddiqui', status: 'paid', paymentMethod: 'cash', discount: 0, by: 'cashier', items: [{ product: 'Coca-Cola 1.5L', quantity: 2 }, { product: 'Lays Masala 40g', quantity: 4 }] },
  { daysAgo: 25, customer: null, status: 'paid', paymentMethod: 'card', discount: 50, by: 'cashier', items: [{ product: 'Olpers Milk 1L', quantity: 3 }, { product: 'Dawn Bread Large', quantity: 1 }, { product: 'Farm Eggs Dozen', quantity: 1 }] },
  { daysAgo: 22, customer: 'Hamza Tariq', status: 'completed', paymentMethod: 'online', discount: 0, by: 'owner', items: [{ product: 'Surf Excel 1kg', quantity: 2 }, { product: 'Harpic 500ml', quantity: 1 }] },
  { daysAgo: 19, customer: 'Fatima Noor', status: 'paid', paymentMethod: 'cash', discount: 100, by: 'cashier', items: [{ product: 'Nescafé Classic 100g', quantity: 1 }, { product: 'Oreo Original 137g', quantity: 2 }] },
  { daysAgo: 16, customer: null, status: 'cancelled', paymentMethod: 'cash', discount: 0, by: 'cashier', items: [{ product: 'Aquafina Water 1.5L', quantity: 6 }] },
  { daysAgo: 14, customer: 'Usman Raza', status: 'paid', paymentMethod: 'card', discount: 0, by: 'owner', items: [{ product: 'Dairy Milk 65g', quantity: 3 }, { product: 'Kurkure Chatpata 62g', quantity: 5 }, { product: 'Coca-Cola 1.5L', quantity: 2 }] },
  { daysAgo: 11, customer: 'Sana Iqbal', status: 'paid', paymentMethod: 'online', discount: 25, by: 'cashier', items: [{ product: 'Nurpur Butter 200g', quantity: 1 }, { product: 'Dawn Bread Large', quantity: 2 }] },
  { daysAgo: 8, customer: 'Ayesha Siddiqui', status: 'unpaid', paymentMethod: 'cash', discount: 0, by: 'cashier', items: [{ product: 'Lipton Yellow Label 190g', quantity: 1 }, { product: 'Peek Freans Sooper 6-pack', quantity: 2 }] },
  { daysAgo: 6, customer: null, status: 'paid', paymentMethod: 'cash', discount: 0, by: 'cashier', items: [{ product: 'Rose Petal Tissues 150s', quantity: 2 }, { product: 'Sufi Soap 130g', quantity: 4 }] },
  { daysAgo: 4, customer: 'Hamza Tariq', status: 'paid', paymentMethod: 'card', discount: 75, by: 'owner', items: [{ product: 'Nestlé Fruita Vitals Mango 1L', quantity: 4 }, { product: 'Oreo Original 137g', quantity: 1 }] },
  { daysAgo: 2, customer: 'Fatima Noor', status: 'unpaid', paymentMethod: 'cash', discount: 0, by: 'cashier', items: [{ product: 'Farm Eggs Dozen', quantity: 2 }, { product: 'Olpers Milk 1L', quantity: 2 }] },
  { daysAgo: 1, customer: null, status: 'paid', paymentMethod: 'online', discount: 0, by: 'cashier', items: [{ product: 'Coca-Cola 1.5L', quantity: 1 }, { product: 'Lays Masala 40g', quantity: 2 }, { product: 'Dairy Milk 65g', quantity: 1 }] },
];

/** Matches the client-side maths in POS-Mobile/src/lib/orderMath.ts. */
const TAX_RATE = 0;

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'postgres',
    entities: [path.join(__dirname, '../src/entities/**/*.entity{.ts,.js}')],
    synchronize: true,
    logging: false,
  });

  await dataSource.initialize();

  const users = dataSource.getRepository(User);
  const stores = dataSource.getRepository(Store);
  const employees = dataSource.getRepository(Employee);
  const categories = dataSource.getRepository(Category);
  const products = dataSource.getRepository(Product);
  const customers = dataSource.getRepository(Customer);
  const orders = dataSource.getRepository(Order);
  const orderItems = dataSource.getRepository(OrderItem);

  try {
    console.log('\n🌱 Seeding demo store\n');

    // ---- Owner -------------------------------------------------------------
    let owner = await users.findOne({ where: { email: OWNER.email } });
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
      console.log(`✅ store_owner  ${OWNER.email} / ${OWNER.password}`);
    } else if (owner.role !== 'store_owner') {
      // Role drift hides most of the app: MainTabs gates the Dashboard tab and
      // MoreScreen gates the whole catalogue menu on `store_owner`, and
      // getUserWithStore only resolves a storeId for owner/employee/cashier.
      // An 'admin' row therefore logs in to an empty shell — repair it.
      const previous = owner.role;
      owner.role = 'store_owner';
      owner = await users.save(owner);
      console.log(`🔧 store_owner  ${OWNER.email} (repaired role: ${previous} → store_owner)`);
    } else {
      console.log(`⏭️  store_owner  ${OWNER.email} (exists)`);
    }

    // ---- Store -------------------------------------------------------------
    let store = await stores.findOne({ where: { userId: owner.id } });
    if (!store) {
      store = await stores.save(stores.create({ ...STORE, userId: owner.id }));
      console.log(`✅ store        ${STORE.name} (${STORE.currency})`);
    } else {
      console.log(`⏭️  store        ${store.name} (exists)`);
    }

    // ---- Cashier -----------------------------------------------------------
    let cashier = await users.findOne({ where: { email: CASHIER.email } });
    if (!cashier) {
      cashier = await users.save(
        users.create({
          email: CASHIER.email,
          passwordHash: await bcrypt.hash(CASHIER.password, 10),
          name: CASHIER.name,
          role: 'employee',
          isActive: true,
        }),
      );
      console.log(`✅ employee     ${CASHIER.email} / ${CASHIER.password}`);
    } else if (cashier.role !== 'employee') {
      const previous = cashier.role;
      cashier.role = 'employee';
      cashier = await users.save(cashier);
      console.log(`🔧 employee     ${CASHIER.email} (repaired role: ${previous} → employee)`);
    } else {
      console.log(`⏭️  employee     ${CASHIER.email} (exists)`);
    }

    const existingEmployee = await employees.findOne({ where: { userId: cashier.id } });
    if (!existingEmployee) {
      await employees.save(
        employees.create({
          storeId: store.id,
          userId: cashier.id,
          employeeId: 'EMP001',
          name: CASHIER.name,
          email: CASHIER.email,
          phone: '+92 300 7654321',
          address: '22 Ferozepur Road, Lahore',
          salary: 65000,
          joinDate: new Date('2025-02-01'),
          designation: 'cashier',
        }),
      );
      console.log('✅ employee_details linked to store');
    } else {
      console.log('⏭️  employee_details (exists)');
    }

    // ---- Categories --------------------------------------------------------
    const categoryByName = new Map<string, Category>();
    for (const c of CATEGORIES) {
      let row = await categories.findOne({ where: { name: c.name, storeId: store.id } });
      if (!row) {
        row = await categories.save(
          categories.create({ ...c, storeId: store.id, isActive: true }),
        );
      }
      categoryByName.set(c.name, row);
    }
    console.log(`✅ categories   ${categoryByName.size}`);

    // ---- Products ----------------------------------------------------------
    const productByName = new Map<string, Product>();
    let newProducts = 0;
    for (const p of PRODUCTS) {
      let row = await products.findOne({ where: { sku: p.sku, storeId: store.id } });
      if (!row) {
        const { category, ...rest } = p;
        row = await products.save(
          products.create({
            ...rest,
            storeId: store.id,
            categoryId: categoryByName.get(category)!.id,
            description: `${p.name} — demo catalogue item`,
            isActive: true,
          }),
        );
        newProducts++;
      }
      productByName.set(p.name, row);
    }
    console.log(`✅ products     ${productByName.size} (${newProducts} new, 4 below low-stock threshold)`);

    // ---- Customers ---------------------------------------------------------
    const customerByName = new Map<string, Customer>();
    for (const c of CUSTOMERS) {
      let row = await customers.findOne({ where: { email: c.email } });
      if (!row) {
        row = await customers.save(customers.create({ ...c, totalSpent: 0, isActive: true }));
      }
      customerByName.set(c.name, row);
    }
    console.log(`✅ customers    ${customerByName.size}`);

    // ---- Orders ------------------------------------------------------------
    const spendByCustomer = new Map<string, number>();
    let newOrders = 0;

    for (let i = 0; i < ORDERS.length; i++) {
      const spec = ORDERS[i];
      const orderNumber = `ORD-${String(1001 + i).padStart(4, '0')}`;

      const existing = await orders.findOne({ where: { orderNumber } });
      if (existing) continue;

      const lines = spec.items.map((line) => {
        const product = productByName.get(line.product)!;
        const unitPrice = Number(product.price);
        const lineTotal = unitPrice * line.quantity;
        return {
          productId: product.id,
          productName: product.name,
          quantity: line.quantity,
          unitPrice,
          subtotal: lineTotal,
          discount: 0,
          total: lineTotal,
        };
      });

      const subtotal = lines.reduce((sum, l) => sum + l.subtotal, 0);
      const total = subtotal + TAX_RATE - spec.discount;
      const customer = spec.customer ? customerByName.get(spec.customer)! : null;

      const order = await orders.save(
        orders.create({
          storeId: store.id,
          orderNumber,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? 'Walk-in Customer',
          createdById: spec.by === 'owner' ? owner.id : cashier.id,
          status: spec.status,
          subtotal,
          tax: TAX_RATE,
          discount: spec.discount,
          total,
          paymentMethod: spec.paymentMethod,
          notes: null,
        } as Partial<Order>),
      );

      await orderItems.save(lines.map((l) => orderItems.create({ ...l, orderId: order.id })));

      // @CreateDateColumn ignores anything passed on insert, so backdate here.
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - spec.daysAgo);
      createdAt.setHours(10 + (i % 9), (i * 7) % 60, 0, 0);
      await dataSource.query('UPDATE orders SET "createdAt" = $1, "updatedAt" = $1 WHERE id = $2', [
        createdAt,
        order.id,
      ]);

      if (customer && (spec.status === 'paid' || spec.status === 'completed')) {
        spendByCustomer.set(customer.id, (spendByCustomer.get(customer.id) ?? 0) + total);
      }
      newOrders++;
    }
    console.log(`✅ orders       ${ORDERS.length} (${newOrders} new, spread over 30 days)`);

    for (const [customerId, spent] of spendByCustomer) {
      await customers.update(customerId, { totalSpent: spent });
    }

    console.log('\n✨ Done. Sign in on the mobile app with:\n');
    console.log(`   Store owner  ${OWNER.email}  /  ${OWNER.password}`);
    console.log(`   Cashier      ${CASHIER.email}  /  ${CASHIER.password}\n`);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await dataSource.destroy();
  }
}

main();
