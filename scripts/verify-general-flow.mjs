const API = process.env.API_URL ?? 'http://localhost:3000/api';

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

const login = async (email, password) => {
  const r = await call('POST', '/auth/login', { email, password });
  return r.body;
};

// ---- The general (existing) flow must be untouched ----
const owner = await login('owner@tapntrade.store', 'owner123');
check('general store owner can log in', !!owner?.accessToken);
check('role is still store_owner (unchanged)', owner?.user?.role === 'store_owner', owner?.user?.role);
check('accountType defaults to general', owner?.user?.accountType === 'general', String(owner?.user?.accountType));
check('effectiveRole is store_owner', owner?.user?.effectiveRole === 'store_owner', owner?.user?.effectiveRole);
check('storeId still resolved', !!owner?.user?.storeId);
check('currency still resolved', !!owner?.user?.currency, owner?.user?.currency);

const cashier = await login('cashier@tapntrade.store', 'cashier123');
check('general employee can log in', !!cashier?.accessToken);
check('employee role unchanged', cashier?.user?.role === 'employee', cashier?.user?.role);
check('general employee effectiveRole is cashier', cashier?.user?.effectiveRole === 'cashier', cashier?.user?.effectiveRole);

const T = owner.accessToken;

// Catalogue reads
const products = await call('GET', `/products?storeId=${owner.user.storeId}`, undefined, T);
check('products list works', products.status === 200 && Array.isArray(products.body), `status ${products.status}`);

const categories = await call('GET', `/categories?storeId=${owner.user.storeId}`, undefined, T);
check('categories list works', categories.status === 200 && Array.isArray(categories.body));

const orders = await call('GET', '/orders?skip=0&take=50', undefined, T);
check('orders list works', orders.status === 200 && Array.isArray(orders.body), `${orders.body?.length} orders`);

// Existing orders must keep their payment status AND gain the new defaults
const existing = orders.body?.[0];
check('existing order kept its status', !!existing?.status, existing?.status);
check('existing order backfilled orderStatus=none', existing?.orderStatus === 'none', String(existing?.orderStatus));
check('existing order backfilled orderType=none', existing?.orderType === 'none', String(existing?.orderType));
check('existing order tableId is null', existing?.tableId === null, String(existing?.tableId));

// The full general sale path: create an order exactly as the POS does
const inStock = (products.body || []).find((p) => Number(p.stock) > 2 && p.isActive);
check('found a stocked product to sell', !!inStock, inStock?.name);

if (inStock) {
  const unitPrice = Number(inStock.price);
  const created = await call(
    'POST',
    '/orders',
    {
      items: [{ productId: inStock.id, quantity: 1, unitPrice, discount: 0 }],
      tax: 0,
      discount: 0,
      status: 'paid',
      paymentMethod: 'cash',
      notes: '',
      total: unitPrice,
    },
    T,
  );
  check('general order creation still works', created.status === 201, `status ${created.status} ${created.body?.message ?? ''}`);
  check('new order defaults to orderStatus=none', created.body?.orderStatus === 'none', String(created.body?.orderStatus));
  check('orderNumber has the collision-safe suffix', /^ORD-\d+-[0-9A-F]{4}$/.test(created.body?.orderNumber ?? ''), created.body?.orderNumber);
  check('legacy orderNumber parsing still yields the timestamp',
    /^\d+$/.test((created.body?.orderNumber ?? '').split('-')[1]),
    (created.body?.orderNumber ?? '').split('-')[1]);

  // Stock must still be deducted for general accounts
  const after = await call('GET', `/products/${inStock.id}`, undefined, T);
  check('stock still deducted on a general sale',
    Number(after.body?.stock) === Number(inStock.stock) - 1,
    `${inStock.stock} -> ${after.body?.stock}`);

  // The receipt path both clients depend on
  const invoice = await call('GET', `/invoices/${created.body.id}`, undefined, T);
  check('invoice generation still works', invoice.status === 200 && !!invoice.body?.invoiceNumber, invoice.body?.invoiceNumber);
}

// Tenancy: the cashier must not read another store's data, and admins still can
const admin = await login('admin@poscloud.com', 'admin123');
const adminOrders = await call('GET', '/orders', undefined, admin.accessToken);
check('platform admin still reads across tenants', adminOrders.status === 200);

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
