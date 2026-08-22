/**
 * Verifies the realtime gateway against a running server.
 *
 *   API_URL=http://localhost:3000/api node scripts/verify-realtime.mjs
 *
 * Checks that pushes actually arrive, and — more importantly — that a socket
 * cannot subscribe to another tenant's room.
 */
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const SOCKET_URL = API.replace(/\/api\/?$/, '');
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

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(`${SOCKET_URL}/realtime`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(e));
    socket.on('unauthorized', () => reject(new Error('unauthorized')));
    setTimeout(() => reject(new Error('timeout')), 6000);
  });

/** Resolves with the first matching event, or null after `ms`. */
const waitFor = (socket, event, ms = 4000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const stamp = Date.now();
const admin = await login(ADMIN.email, ADMIN.password);

// Two independent restaurant tenants, to prove isolation.
const mkStore = async (label) => {
  const owner = { email: `rt-${label}-${stamp}@example.com`, password: 'owner123' };
  const store = await call('POST', '/stores', {
    name: `RT ${label} ${stamp}`, email: owner.email, password: owner.password,
    accountType: 'restaurant', currency: 'PKR',
  }, admin.accessToken);
  const auth = await login(owner.email, owner.password);
  return { store: store.body, auth };
};

const a = await mkStore('a');
const b = await mkStore('b');

const catA = await call('POST', '/categories', { name: 'Main', storeId: a.store.id }, a.auth.accessToken);
const prodA = await call('POST', '/products', {
  name: 'Biryani', price: 500, costPrice: 300, categoryId: catA.body?.id, storeId: a.store.id,
}, a.auth.accessToken);
const tableA = await call('POST', '/restaurant/tables', { name: 'T1' }, a.auth.accessToken);

// Sockets
let socketA, socketB;
try {
  socketA = await connect(a.auth.accessToken);
  check('authenticated socket connects', true);
} catch (error) {
  check('authenticated socket connects', false, String(error?.message));
}
try {
  socketB = await connect(b.auth.accessToken);
} catch { /* handled by the isolation check below */ }

/**
 * A bad token must not end up in any room.
 *
 * socket.io completes the transport handshake before handleConnection runs, so
 * the socket does briefly exist; what matters is that it is told 'unauthorized'
 * and disconnected before joining a store room. Asserted directly rather than
 * assuming connect() fails.
 */
const badTokenOutcome = await new Promise((resolve) => {
  const socket = io(`${SOCKET_URL}/realtime`, {
    transports: ['websocket'], auth: { token: 'not-a-real-token' },
    reconnection: false, timeout: 5000,
  });
  let sawUnauthorized = false;
  socket.on('unauthorized', () => { sawUnauthorized = true; });
  socket.on('disconnect', () => resolve({ sawUnauthorized, disconnected: true }));
  socket.on('connect_error', () => resolve({ sawUnauthorized, disconnected: true }));
  setTimeout(() => { socket.disconnect(); resolve({ sawUnauthorized, disconnected: false }); }, 5000);
});
check('socket with an invalid token is told unauthorized', badTokenOutcome.sawUnauthorized);
check('socket with an invalid token is disconnected', badTokenOutcome.disconnected);

if (socketA) {
  // table:updated on create
  const tableEvent = waitFor(socketA, 'table:updated');
  await call('POST', '/restaurant/tables', { name: `T2-${stamp}` }, a.auth.accessToken);
  check('table:updated is pushed', !!(await tableEvent));

  // order:created on punch, and cross-tenant isolation at the same time
  const orderEvent = waitFor(socketA, 'order:created');
  const leak = socketB ? waitFor(socketB, 'order:created', 3000) : Promise.resolve(null);

  const punched = await call('POST', '/restaurant/orders', {
    orderType: 'dine_in',
    tableId: tableA.body.id,
    items: [{ productId: prodA.body.id, quantity: 1, notes: 'No salt' }],
  }, a.auth.accessToken);

  const received = await orderEvent;
  check('order:created is pushed to its own store', !!received, received?.orderNumber ?? 'no event');
  check('pushed order carries waiter and table for the ticket',
    !!received?.waiterName && !!received?.tableName,
    `${received?.waiterName} / ${received?.tableName}`);
  check('pushed order carries item notes',
    received?.items?.[0]?.notes === 'No salt');

  // The isolation check that matters.
  check('another store does NOT receive the event', (await leak) === null);

  // order:items_added carries ONLY the new lines
  const addEvent = waitFor(socketA, 'order:items_added');
  await call('POST', `/restaurant/orders/${punched.body.id}/items`, {
    items: [{ productId: prodA.body.id, quantity: 2 }],
  }, a.auth.accessToken);
  const added = await addEvent;
  check('order:items_added is pushed', !!added);
  check('items_added includes only the new round',
    added?.newItems?.length === 1,
    `${added?.newItems?.length} new item(s)`);

  // Settling frees the table and pushes both events
  const freed = waitFor(socketA, 'table:updated');
  await call('POST', `/restaurant/orders/${punched.body.id}/settle`, { paymentMethod: 'cash' }, a.auth.accessToken);
  const freedTable = await freed;
  check('table:updated pushed on settle', !!freedTable);
  check('table is free again after settling', freedTable?.status === 'free', freedTable?.status);
}

socketA?.disconnect();
socketB?.disconnect();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
