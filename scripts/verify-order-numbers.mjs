/**
 * Verifies per-restaurant order numbering (1, 2, 3… per store) against a
 * running server.
 *
 *   API_URL=http://localhost:3000/api node scripts/verify-order-numbers.mjs
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

const mk = async (label) => {
  const owner = { email: `seq-${label}-${stamp}@x.com`, password: 'owner123' };
  await call('POST', '/stores', {
    name: `Seq ${label} ${stamp}`, email: owner.email, password: owner.password,
    accountType: 'restaurant', currency: 'PKR',
  }, admin.accessToken);
  const auth = await login(owner.email, owner.password);
  const cat = await call('POST', '/categories', { name: 'M', storeId: auth.user.storeId }, auth.accessToken);
  const prod = await call('POST', '/products', {
    name: 'Dish', price: 100, costPrice: 40, categoryId: cat.body?.id, storeId: auth.user.storeId,
  }, auth.accessToken);
  return { auth, productId: prod.body.id };
};

const a = await mk('a');
const b = await mk('b');

// Sequential numbering, per store, starting at 1.
const seqs = [];
for (let i = 0; i < 4; i++) {
  const r = await call('POST', '/restaurant/orders', {
    orderType: 'takeaway', items: [{ productId: a.productId, quantity: 1 }],
  }, a.auth.accessToken);
  seqs.push(r.body?.orderSequence);
}
check('first order is #1', seqs[0] === 1, String(seqs[0]));
check('numbers increment 1,2,3,4', JSON.stringify(seqs) === '[1,2,3,4]', JSON.stringify(seqs));

// A second restaurant counts independently, also from 1.
const other = await call('POST', '/restaurant/orders', {
  orderType: 'takeaway', items: [{ productId: b.productId, quantity: 1 }],
}, b.auth.accessToken);
check('a different restaurant also starts at #1', other.body?.orderSequence === 1, String(other.body?.orderSequence));

// Concurrency: 6 simultaneous orders must produce 6 DISTINCT numbers.
const burst = await Promise.all(
  Array.from({ length: 6 }, () =>
    call('POST', '/restaurant/orders', {
      orderType: 'takeaway', items: [{ productId: a.productId, quantity: 1 }],
    }, a.auth.accessToken)),
);
const burstSeqs = burst.map((r) => r.body?.orderSequence).filter(Boolean).sort((x, y) => x - y);
check('concurrent orders get unique numbers',
  new Set(burstSeqs).size === 6, JSON.stringify(burstSeqs));
check('concurrent numbers continue the run (5..10)',
  JSON.stringify(burstSeqs) === '[5,6,7,8,9,10]', JSON.stringify(burstSeqs));

// Drafts consume a number too, and it survives punching.
const draft = await call('POST', '/restaurant/orders', {
  orderType: 'takeaway', items: [{ productId: a.productId, quantity: 1 }], isDraft: true,
}, a.auth.accessToken);
check('draft receives a number', !!draft.body?.orderSequence, String(draft.body?.orderSequence));
const punched = await call('POST', `/restaurant/orders/${draft.body.id}/punch`, {}, a.auth.accessToken);
check('number is unchanged after punching',
  punched.body?.orderSequence === draft.body?.orderSequence,
  `${draft.body?.orderSequence} -> ${punched.body?.orderSequence}`);

// The invoice the receipt is printed from carries it.
const inv = await call('GET', `/invoices/${punched.body.id}`, undefined, a.auth.accessToken);
check('invoice carries orderSequence',
  inv.body?.order?.orderSequence === draft.body?.orderSequence,
  String(inv.body?.order?.orderSequence));

// orderNumber must stay globally unique across stores.
const allNums = [...burst.map(r => r.body?.orderNumber), other.body?.orderNumber].filter(Boolean);
check('internal orderNumber still globally unique',
  allNums.length === 7 && new Set(allNums).size === allNums.length,
  `${allNums.length} numbers collected`);

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? '  (' + r.d + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
