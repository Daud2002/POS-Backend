/**
 * Verifies server-side pagination against a running server.
 *
 *   API_URL=http://localhost:3000/api node scripts/verify-pagination.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const call = async (m, p, b, t) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call('POST', '/auth/login', { email: e, password: p })).body;

const results = [];
const check = (n, pass, d = '') => results.push({ n, pass, d });

const stamp = Date.now();
const admin = await login('admin@poscloud.com', 'admin123');

// A restaurant with enough orders to span pages.
const owner = { email: `pg-${stamp}@x.com`, password: 'owner123' };
await call('POST', '/stores', {
  name: `Pg ${stamp}`, email: owner.email, password: owner.password,
  accountType: 'restaurant', currency: 'PKR',
}, admin.accessToken);
const auth = await login(owner.email, owner.password);
const T = auth.accessToken;
const storeId = auth.user.storeId;

const cat = await call('POST', '/categories', { name: 'M', storeId }, T);
const prod = await call('POST', '/products', {
  name: 'Dish', price: 100, costPrice: 40, categoryId: cat.body?.id, storeId,
}, T);

for (let i = 0; i < 7; i++) {
  await call('POST', '/restaurant/orders', {
    orderType: 'takeaway', items: [{ productId: prod.body.id, quantity: 1 }],
  }, T);
}

// Default (no withCount) must stay a bare array — old clients depend on it.
const legacy = await call('GET', '/restaurant/orders', undefined, T);
check('without withCount the response is still a bare array', Array.isArray(legacy.body),
  Array.isArray(legacy.body) ? `${legacy.body.length} items` : typeof legacy.body);

// Paged envelope
const p1 = await call('GET', '/restaurant/orders?withCount=true&skip=0&take=3', undefined, T);
check('withCount returns an envelope',
  !!p1.body && Array.isArray(p1.body.items) && typeof p1.body.total === 'number',
  JSON.stringify(Object.keys(p1.body ?? {})));
check('page size is respected', p1.body?.items?.length === 3, String(p1.body?.items?.length));
check('total counts every matching row', p1.body?.total === 7, String(p1.body?.total));

const p2 = await call('GET', '/restaurant/orders?withCount=true&skip=3&take=3', undefined, T);
check('second page returns the next rows', p2.body?.items?.length === 3);

const p3 = await call('GET', '/restaurant/orders?withCount=true&skip=6&take=3', undefined, T);
check('last page returns the remainder', p3.body?.items?.length === 1, String(p3.body?.items?.length));

// No overlap across pages — the join onto items must not duplicate orders.
const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((o) => o.id);
check('pages do not overlap or duplicate', new Set(ids).size === 7, `${new Set(ids).size} unique of ${ids.length}`);

// Filters must be counted, not just sliced.
const drafted = await call('POST', '/restaurant/orders', {
  orderType: 'takeaway', items: [{ productId: prod.body.id, quantity: 1 }], isDraft: true,
}, T);
const filtered = await call('GET', '/restaurant/orders?withCount=true&orderStatus=draft&take=50', undefined, T);
check('total respects the status filter', filtered.body?.total === 1, String(filtered.body?.total));

// take is capped so a caller cannot pull the whole table.
const huge = await call('GET', '/restaurant/orders?withCount=true&take=99999', undefined, T);
check('take is capped at 200', huge.body?.take === 200, String(huge.body?.take));

// Junk paging params must not 500.
const junk = await call('GET', '/restaurant/orders?withCount=true&skip=abc&take=-5', undefined, T);
check('invalid paging params fall back to defaults',
  junk.status === 200 && junk.body?.skip === 0 && junk.body?.take === 20,
  `skip=${junk.body?.skip} take=${junk.body?.take}`);

// Other paged endpoints
const prods = await call('GET', `/products?withCount=true&storeId=${storeId}&take=1`, undefined, T);
check('products paginate', prods.body?.total === 1 && prods.body.items.length === 1, String(prods.body?.total));

const emps = await call('GET', `/employees/store/${storeId}?withCount=true&take=5`, undefined, T);
check('employees paginate', typeof emps.body?.total === 'number', String(emps.body?.total));

const stores = await call('GET', '/stores?withCount=true&take=2', undefined, admin.accessToken);
check('stores paginate', stores.body?.items?.length <= 2 && stores.body?.total > 0,
  `${stores.body?.items?.length} of ${stores.body?.total}`);

const users = await call('GET', '/users?withCount=true&take=2&role=store_owner', undefined, admin.accessToken);
check('users paginate and filter by role',
  users.body?.items?.every((u) => u.role === 'store_owner'), `${users.body?.total} owners`);
check('paged users never leak passwordHash',
  users.body?.items?.every((u) => !('passwordHash' in u)));

const allEmps = await call('GET', '/employees?withCount=true&take=3', undefined, admin.accessToken);
check('cross-store employees endpoint works', allEmps.status === 200 && Array.isArray(allEmps.body?.items),
  `status ${allEmps.status}`);
check('cross-store employees is admin-only', (await call('GET', '/employees?withCount=true', undefined, T)).status === 403);

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? '  (' + r.d + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
