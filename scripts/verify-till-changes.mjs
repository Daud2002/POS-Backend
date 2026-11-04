/**
 * End-to-end check of the November 2026 till changes against a running server.
 *
 *   API_URL=http://localhost:3000/api node scripts/verify-till-changes.mjs
 *
 * Creates its own restaurant tenant, so it never touches existing data.
 *
 * - a waiter can strike lines off an order; it is in the history, and a
 *   printed bill has to be printed again;
 * - the till's "Print bill & update" keeps an edit away from the kitchen;
 * - with shifts on, a cashier or supervisor needs an open shift for every
 *   write that changes what the drawer will collect;
 * - revenue includes delivery charges, and the item sales list adds up;
 * - expense subcategories: typed in on the form, filtered and broken down.
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const ADMIN = { email: 'admin@poscloud.com', password: 'admin123' };

const call = async (method, path, body, token) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });
const login = async (email, password) => (await call('POST', '/auth/login', { email, password })).body;

const stamp = Date.now();
const owner = { email: `till-owner-${stamp}@example.com`, password: 'owner123' };
const waiter = { email: `till-waiter-${stamp}@example.com`, password: 'waiter123' };
const cashier = { email: `till-cashier-${stamp}@example.com`, password: 'cashier123' };
const supervisor = { email: `till-sup-${stamp}@example.com`, password: 'super123' };

// ---------------------------------------------------------------- setup
const admin = await login(ADMIN.email, ADMIN.password);
const store = await call('POST', '/stores', {
  name: `Till Test ${stamp}`,
  email: owner.email,
  password: owner.password,
  accountType: 'restaurant',
  currency: 'PKR',
}, admin.accessToken);
check('super admin creates a restaurant store', store.status === 201, `status ${store.status}`);
const storeId = store.body?.id;
const OT = (await login(owner.email, owner.password)).accessToken;

let empSeq = 0;
const mkEmp = (e, designation, name) =>
  call('POST', `/employees/store/${storeId}`, {
    name, email: e.email, password: e.password,
    employeeId: `T${++empSeq}-${stamp}`.slice(0, 24),
    designation,
  }, OT);
const cashierEmp = await mkEmp(cashier, 'cashier', 'Cash Desk');
check('create staff',
  (await mkEmp(waiter, 'waiter', 'Ali Waiter')).status === 201 &&
    cashierEmp.status === 201 &&
    (await mkEmp(supervisor, 'supervisor', 'Shift Lead')).status === 201);
const WT = (await login(waiter.email, waiter.password)).accessToken;
const CT = (await login(cashier.email, cashier.password)).accessToken;
const ST = (await login(supervisor.email, supervisor.password)).accessToken;

const cat = await call('POST', '/categories', { name: 'Mains', storeId }, OT);
const biryani = await call('POST', '/products', { name: 'Biryani', price: 500, costPrice: 300, categoryId: cat.body?.id, storeId }, OT);
const karahi = await call('POST', '/products', { name: 'Karahi', price: 1200, costPrice: 800, categoryId: cat.body?.id, storeId }, OT);
const t1 = await call('POST', '/restaurant/tables', { name: 'Table 1' }, OT);
const t2 = await call('POST', '/restaurant/tables', { name: 'Table 2' }, OT);
check('catalogue and tables', biryani.status === 201 && karahi.status === 201 && t1.status === 201 && t2.status === 201);

// ------------------------------------------------ 1. waiter strikes lines
const dineIn = await call('POST', '/restaurant/orders', {
  orderType: 'dine_in', tableId: t1.body.id,
  items: [{ productId: biryani.body.id, quantity: 2 }, { productId: karahi.body.id, quantity: 1 }],
}, WT);
check('waiter punches a dine-in', dineIn.status === 201, `status ${dineIn.status}`);
const printed = await call('POST', `/restaurant/orders/${dineIn.body.id}/print-bill`, {}, CT);
check('cashier prints the bill (shifts are still off)', printed.status === 201 && printed.body?.billPrinted === true, `status ${printed.status}`);

const biryaniLine = dineIn.body?.items?.find((i) => i.productId === biryani.body.id);
const waiterRemove = await call('POST', `/restaurant/orders/${dineIn.body.id}/items/remove`, {
  items: [{ orderItemId: biryaniLine?.id, quantity: 1 }],
}, WT);
check('a waiter can strike a line off', waiterRemove.status === 201, `status ${waiterRemove.status} ${waiterRemove.body?.message ?? ''}`);
check("the waiter's removal moves the total (1 biryani + 1 karahi)", Number(waiterRemove.body?.total) === 1700, String(waiterRemove.body?.total));
check('the printed bill is no longer marked printed', waiterRemove.body?.billPrinted === false, String(waiterRemove.body?.billPrinted));
check('a waiter cannot strike every line — cancel instead',
  (await call('POST', `/restaurant/orders/${dineIn.body.id}/items/remove`, {
    items: waiterRemove.body.items.map((i) => ({ orderItemId: i.id })),
  }, WT)).status === 409);

const history = await call('GET', `/restaurant/orders/${dineIn.body.id}/history`, undefined, OT);
const removal = history.body?.events?.find((e) => e.type === 'items_removed');
check('the removal is in the order history with the waiter named',
  removal?.actorRole === 'waiter' && removal?.actorName === 'Ali Waiter' &&
    removal?.payload?.lines?.[0]?.productName === 'Biryani' && removal?.payload?.lines?.[0]?.quantity === 1,
  JSON.stringify(removal?.payload?.lines ?? removal));

// ----------------------------------------- 3. "Print bill & update" (held)
const held = await call('POST', `/restaurant/orders/${dineIn.body.id}/items`, {
  items: [{ productId: karahi.body.id, quantity: 1 }], sendToKitchen: false,
}, CT);
const heldLine = held.body?.items?.filter((i) => i.productId === karahi.body.id).at(-1);
check('a held round is billed', held.status === 201 && Number(held.body?.total) === 2900, `status ${held.status} total ${held.body?.total}`);
check('a held round never reaches the kitchen', heldLine?.skipKitchen === true, String(heldLine?.skipKitchen));

const waiterHeld = await call('POST', `/restaurant/orders/${dineIn.body.id}/items`, {
  items: [{ productId: biryani.body.id, quantity: 1 }], sendToKitchen: false,
}, WT);
const waiterLine = waiterHeld.body?.items?.filter((i) => i.productId === biryani.body.id).at(-1);
check("a waiter's round always goes to the kitchen", waiterLine?.skipKitchen === false, String(waiterLine?.skipKitchen));

// --------------------------------------------- 5. shifts gate the till
check('owner turns shifts on',
  (await call('PATCH', `/stores/${storeId}/settings`, { shiftsEnabled: true }, OT)).body?.shiftsEnabled === true);

const takeaway = { orderType: 'takeaway', items: [{ productId: biryani.body.id, quantity: 1 }] };
const noShift = await call('POST', '/restaurant/orders', takeaway, CT);
check('a cashier with no shift cannot punch an order', noShift.status === 409 && /Open your shift/.test(noShift.body?.message ?? ''),
  `status ${noShift.status} ${noShift.body?.message ?? ''}`);
check('a supervisor with no shift cannot either', (await call('POST', '/restaurant/orders', takeaway, ST)).status === 409);
check('a cashier with no shift cannot print a bill',
  (await call('POST', `/restaurant/orders/${dineIn.body.id}/print-bill`, {}, CT)).status === 409);
check('…nor add a round',
  (await call('POST', `/restaurant/orders/${dineIn.body.id}/items`, { items: takeaway.items }, CT)).status === 409);
check('…nor strike a line',
  (await call('POST', `/restaurant/orders/${dineIn.body.id}/items/remove`, {
    items: [{ orderItemId: heldLine?.id }],
  }, CT)).status === 409);
check('…nor cancel', (await call('POST', `/restaurant/orders/${dineIn.body.id}/cancel`, {}, CT)).status === 409);
check('…nor book an expense',
  (await call('POST', '/expenses', { title: 'Ice', amount: 100, paymentMethod: 'cash' }, ST)).status === 409);
check('a waiter needs no shift to strike a line',
  (await call('POST', `/restaurant/orders/${dineIn.body.id}/items/remove`, {
    items: [{ orderItemId: waiterLine?.id }],
  }, WT)).status === 201);
check('the owner needs no shift to punch', (await call('POST', '/restaurant/orders', takeaway, OT)).status === 201);

check('the cashier opens a shift', (await call('POST', '/shifts/open', { openingFloat: 1000 }, CT)).status === 201);
const withShift = await call('POST', '/restaurant/orders', takeaway, CT);
check('with a shift open the cashier can punch', withShift.status === 201, `status ${withShift.status} ${withShift.body?.message ?? ''}`);

// ------------------------------------------------- 4. revenue + item sales
const delivery = await call('POST', '/restaurant/orders', {
  orderType: 'delivery', customerName: 'Sana', customerPhone: '03001234567', deliveryAddress: 'Street 1',
  items: [{ productId: karahi.body.id, quantity: 1 }], deliveryCharge: 150, printBill: true,
}, CT);
check('a delivery with a charge is punched and printed', delivery.status === 201 && Number(delivery.body?.total) === 1350,
  `status ${delivery.status} total ${delivery.body?.total}`);
const paid = await call('POST', `/restaurant/orders/${delivery.body.id}/settle`, { paymentMethod: 'cash' }, CT);
check('it is settled', paid.status === 201, `status ${paid.status} ${paid.body?.message ?? ''}`);

const sales = await call('GET', '/restaurant/reports/sales', undefined, OT);
check('revenue includes the delivery charge', Number(sales.body?.revenue) === 1350, String(sales.body?.revenue));
check('the charge is still reported on its own', Number(sales.body?.deliveryChargeTotal) === 150, String(sales.body?.deliveryChargeTotal));
const profit = await call('GET', '/reports/profit?tz=Asia/Karachi', undefined, OT);
check('the profit cards count it too', Number(profit.body?.periods?.today?.revenue) === 1350, String(profit.body?.periods?.today?.revenue));

const items = await call('GET', '/reports/item-sales?groupBy=day&tz=Asia/Karachi', undefined, OT);
check('the item sales list shows what was sold', items.status === 200 &&
  items.body?.rows?.length === 1 && items.body.rows[0].name === 'Karahi' && items.body.rows[0].quantity === 1 &&
  items.body.rows[0].revenue === 1200 && /^\d{4}-\d{2}-\d{2}$/.test(items.body.rows[0].period),
  JSON.stringify(items.body?.rows));
check('a waiter cannot read item sales', (await call('GET', '/reports/item-sales', undefined, WT)).status === 403);
check('a bad date is a 400, not an empty list', (await call('GET', '/reports/item-sales?from=yesterday', undefined, OT)).status === 400);

// --------------------------------------------------- 8. expense subcategories
const petrol = await call('POST', '/expenses/categories', { name: 'Petrol' }, OT);
const rent = await call('POST', '/expenses/categories', { name: 'Rent' }, OT);
check('owner creates expense categories', petrol.status === 201 && rent.status === 201);

const grant = await call('PATCH', `/employees/${cashierEmp.body?.id}/permissions`, { permissions: ['expenses'] }, OT);
check('owner grants the ledger to the cashier', grant.status === 200, `status ${grant.status}`);
const CT2 = (await login(cashier.email, cashier.password)).accessToken;

const first = await call('POST', '/expenses', {
  title: 'Rider fuel', amount: 500, paymentMethod: 'cash', categoryId: petrol.body.id, subcategoryName: 'Ahmad',
}, CT2);
check('a cashier types a new subcategory on the expense form', first.status === 201 && first.body?.subcategory?.name === 'Ahmad',
  `status ${first.status} ${first.body?.message ?? ''}`);
const second = await call('POST', '/expenses', {
  title: 'Rider fuel', amount: 700, paymentMethod: 'cash', categoryId: petrol.body.id, subcategoryName: 'ahmad',
}, CT2);
check('typing it again finds the same one', second.body?.subcategoryId === first.body?.subcategoryId);
await call('POST', '/expenses', {
  title: 'Rider fuel', amount: 300, paymentMethod: 'card', categoryId: petrol.body.id, subcategoryName: 'Bilal',
}, OT);
check('a subcategory needs its category',
  (await call('POST', '/expenses', { title: 'X', amount: 1, subcategoryId: first.body?.subcategoryId, categoryId: rent.body.id }, OT)).status === 400);

const cats = await call('GET', '/expenses/categories', undefined, CT2);
const petrolSubs = cats.body?.find((c) => c.id === petrol.body.id)?.subcategories?.map((s) => s.name);
check('categories come with their subcategories', petrolSubs?.join(',') === 'Ahmad,Bilal', String(petrolSubs));

const ahmadOnly = await call('GET', `/expenses?categoryId=${petrol.body.id}&subcategoryId=${first.body?.subcategoryId}&withCount=true`, undefined, OT);
check('filtering Petrol › Ahmad totals what Ahmad was paid', Number(ahmadOnly.body?.filteredTotal) === 1200, String(ahmadOnly.body?.filteredTotal));
const breakdown = await call('GET', '/expenses/breakdown', undefined, OT);
const petrolRow = breakdown.body?.find((c) => c.categoryId === petrol.body.id);
check('the breakdown splits Petrol by subcategory',
  petrolRow?.total === 1500 && petrolRow?.subcategories?.[0]?.name === 'Ahmad' && petrolRow?.subcategories?.[0]?.total === 1200,
  JSON.stringify(petrolRow));

const moved = await call('PATCH', `/expenses/${first.body.id}`, { categoryId: rent.body.id }, OT);
check('moving an expense to another category clears its subcategory', moved.status === 200 && moved.body?.subcategoryId === null,
  `status ${moved.status} ${moved.body?.subcategoryId}`);
check('a cashier cannot rename a subcategory',
  (await call('PATCH', `/expenses/subcategories/${first.body?.subcategoryId}`, { name: 'Ahmed' }, CT2)).status === 403);
const renamed = await call('PATCH', `/expenses/subcategories/${first.body?.subcategoryId}`, { name: 'Ahmed' }, OT);
check('the owner renames it', renamed.status === 200 && renamed.body?.name === 'Ahmed', `status ${renamed.status}`);
const removed = await call('DELETE', `/expenses/subcategories/${first.body?.subcategoryId}`, undefined, OT);
const afterDelete = await call('GET', `/expenses/${second.body?.id}`, undefined, OT);
check('deleting it keeps the expenses in their category',
  removed.status === 200 && afterDelete.body?.categoryId === petrol.body.id && afterDelete.body?.subcategoryId === null,
  `status ${removed.status} ${afterDelete.body?.subcategoryId}`);

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
