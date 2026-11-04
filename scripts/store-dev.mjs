// Try the store server on a laptop. Nothing here reads .env (production):
// every setting is passed explicitly.
//
//   npm run store:dev
//       A practice cloud AND a store server, each on its own throwaway
//       Postgres, with a seeded restaurant. Press c to cut the "internet"
//       (stops the practice cloud) and c again to bring it back; q quits.
//       Cloud:        http://localhost:3100/api
//       Store server: https://localhost:8443  (setup: http://localhost:8088/setup)
//       Logins:       owner@snack.test / owner123, waiter@snack.test / waiter123
//
//   npm run store:dev -- --cloud https://api.tapntrade.store/api
//       Only the store server, linked to a REAL cloud. Its data and pairing
//       are kept in ~/.tapntrade-store-laptop between runs (--reset wipes it).
//       Pair it with a TEST store: activating a store moves its orders onto
//       this laptop.
//
//   npm run store:dev -- --smoke
//       The whole pairing → order → sync loop against a practice cloud, then exit.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { startEmbeddedPostgres } from './lib/embedded-pg.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smoke = process.argv.includes('--smoke');
const cloudFlag = process.argv.indexOf('--cloud');
const realCloud = cloudFlag > -1 ? process.argv[cloudFlag + 1] : null;
const dataDir = realCloud
  ? path.join(os.homedir(), '.tapntrade-store-laptop')
  : path.join(os.tmpdir(), 'tapntrade-store-dev');
const CLOUD = 'http://localhost:3100/api';
const STORE = 'https://localhost:8443/api';
// Not 8080: that is where POS-Frontend's `npm run dev` listens.
const STORE_HTTP = 'http://localhost:8088';
const WEB_DIST = path.join(root, '..', 'POS-Frontend', 'dist-store');
const children = [];

function backend(name, env) {
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register', 'src/main.ts'],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TZ: 'UTC',
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
        // A path that does not exist: ConfigModule must never load .env here.
        TAPNTRADE_CONFIG: path.join(dataDir, 'no-env-file'),
        DATABASE_HOST: '127.0.0.1',
        DATABASE_USER: 'postgres',
        DATABASE_PASSWORD: 'postgres',
        DATABASE_NAME: 'tapntrade',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const prefix = (chunk) =>
    chunk
      .toString()
      .split('\n')
      .filter(Boolean)
      .filter((line) => !smoke && /ERROR|WARN|Store server running|Copied the store|Sync failed|Application is running/.test(line))
      .forEach((line) => console.log(`[${name}] ${line.replace(/^\[Nest\]\s+\d+\s+-\s+/, '')}`));
  child.stdout.on('data', prefix);
  child.stderr.on('data', (c) => process.stderr.write(`[${name}] ${c}`));
  children.push(child);
  return child;
}

let caPem;
async function call(base, method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (base.startsWith('https')) {
    caPem ??= readFileSync(path.join(dataDir, 'keys', 'ca.crt'), 'utf8');
    return new Promise((resolve, reject) => {
      const req = https.request(`${base}${url}`, { method, headers, ca: caPem }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
  const res = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body: parsed };
}

async function waitFor(base, label) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await call(base, 'GET', '/health');
      if (res.status === 200) return res.body;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start`);
}

async function seedCloud(config) {
  const db = new pg.Client({ ...config, user: config.username });
  await db.connect();
  const owner = (
    await db.query(
      `INSERT INTO users (email, "passwordHash", role, name) VALUES ('owner@snack.test', $1, 'store_owner', 'Owner') RETURNING id`,
      [await bcrypt.hash('owner123', 10)],
    )
  ).rows[0];
  const store = (
    await db.query(
      `INSERT INTO stores (name, "userId", "accountType", currency) VALUES ('Snack Dev', $1, 'restaurant', 'PKR') RETURNING id`,
      [owner.id],
    )
  ).rows[0];
  const waiter = (
    await db.query(
      `INSERT INTO users (email, "passwordHash", role, name) VALUES ('waiter@snack.test', $1, 'employee', 'Waiter') RETURNING id`,
      [await bcrypt.hash('waiter123', 10)],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO employee_details ("storeId", "userId", "employeeId", name, email, designation) VALUES ($1, $2, 'W1', 'Waiter', 'waiter@snack.test', 'waiter')`,
    [store.id, waiter.id],
  );
  const category = (await db.query(`INSERT INTO categories ("storeId", name, "sortOrder") VALUES ($1, 'Burgers', 1) RETURNING id`, [store.id])).rows[0];
  const product = (
    await db.query(`INSERT INTO products ("storeId", "categoryId", name, price, stock) VALUES ($1, $2, 'Zinger', 450, 50) RETURNING id`, [
      store.id,
      category.id,
    ])
  ).rows[0];
  const table = (await db.query(`INSERT INTO restaurant_tables ("storeId", name) VALUES ($1, 'T1') RETURNING id`, [store.id])).rows[0];
  return { db, storeId: store.id, productId: product.id, tableId: table.id };
}

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

function lanIp() {
  return (
    Object.values(os.networkInterfaces())
      .flat()
      .find((n) => n && n.family === 'IPv4' && !n.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(n.address))
      ?.address ?? 'localhost'
  );
}

function storeServer(env) {
  return backend('store', {
    DEPLOYMENT_MODE: 'store',
    HTTPS_PORT: '8443',
    HTTP_PORT: '8088',
    TAPNTRADE_DATA_DIR: dataDir,
    WEB_DIST_DIR: WEB_DIST,
    ...env,
  });
}

async function waitForSetupPage() {
  // The store server writes its CA before listening; wait for it over HTTP first.
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${STORE_HTTP}/setup`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('store server did not start');
}

/** Single keys while running: q quits, and `extra` maps more keys to actions. */
function onKeys(stopAll, extra = {}) {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (key) => {
    const k = key.toString();
    if (k === 'q' || k === '\u0003') {
      await stopAll();
      process.exit(0);
    }
    if (extra[k]) await extra[k]();
  });
}

/** Only a store server, linked to a real cloud, with its data kept between runs. */
async function runAgainstRealCloud() {
  if (process.argv.includes('--reset')) rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secretFile = path.join(dataDir, 'jwt-secret');
  if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString('base64url'), { mode: 0o600 });

  const storePg = await startEmbeddedPostgres({ port: 54413, dir: path.join(dataDir, 'pgdata') });
  const stopAll = async () => {
    children.forEach((c) => c.kill('SIGTERM'));
    await storePg.stop();
  };
  process.on('SIGINT', () => stopAll().then(() => process.exit(0)));

  storeServer({
    DATABASE_PORT: '54413',
    JWT_SECRET: readFileSync(secretFile, 'utf8'),
    CLOUD_API_URL: realCloud.replace(/\/+$/, ''),
  });
  await waitForSetupPage();
  const ip = lanIp();
  console.log(`
Store server is running, linked to ${realCloud}

  Setup page (pairing, certificate, QR):  ${STORE_HTTP}/setup
  TapNtrade on this laptop:               https://localhost:8443
  From a phone on the same Wi-Fi:         http://${ip}:8088/setup  then  https://${ip}:8443
  ${existsSync(WEB_DIST) ? '' : '(web app not built yet: run `npm run build:store` in POS-Frontend, then restart)\n'}
  Data and pairing are kept in ${dataDir}
  Press q to stop.`);
  onKeys(stopAll);
}

async function main() {
  if (realCloud) return runAgainstRealCloud();
  rmSync(dataDir, { recursive: true, force: true });
  const [cloudPg, storePg] = await Promise.all([
    startEmbeddedPostgres({ port: 54411 }),
    startEmbeddedPostgres({ port: 54412 }),
  ]);
  const stopAll = async () => {
    children.forEach((c) => c.kill('SIGTERM'));
    await Promise.all([cloudPg.stop(), storePg.stop()]);
  };
  process.on('SIGINT', () => stopAll().then(() => process.exit(0)));

  try {
    const startCloud = () =>
      backend('cloud', { DEPLOYMENT_MODE: 'cloud', PORT: '3100', DATABASE_PORT: '54411', JWT_SECRET: 'dev-cloud-secret' });
    let cloud = startCloud();
    await waitFor(CLOUD, 'cloud');
    const seed = await seedCloud(cloudPg.config);

    storeServer({ DATABASE_PORT: '54412', JWT_SECRET: 'dev-store-secret', CLOUD_API_URL: CLOUD });
    await waitForSetupPage();
    const health = await waitFor(STORE, 'store server');

    if (!smoke) {
      const ip = lanIp();
      console.log(`
Practice cloud and store server are running (fresh data every start).

  1. Cloud web app:  in POS-Frontend run  VITE_API_URL=${CLOUD} npm run dev
     open http://localhost:8080, sign in as owner@snack.test / owner123,
     Settings → Store Server → Generate pairing code
  2. Setup page:     ${STORE_HTTP}/setup  → type the code → Link
  3. Back in the cloud web app: Activate
  4. Store server:   https://localhost:8443  (waiter@snack.test / waiter123)
     From a phone on the same Wi-Fi: http://${ip}:8088/setup, then https://${ip}:8443
  ${existsSync(WEB_DIST) ? '' : '(web app not built yet: run `npm run build:store` in POS-Frontend, then restart)\n'}
  Press c to cut the internet (stops the practice cloud), c again to restore it. q quits.`);
      onKeys(stopAll, {
        c: async () => {
          if (cloud.exitCode === null && !cloud.killed) {
            cloud.kill('SIGTERM');
            console.log('\n✂️  Internet cut: the cloud is down. The store server keeps taking orders; they wait to sync.');
          } else {
            cloud = startCloud();
            await waitFor(CLOUD, 'cloud');
            console.log('\n🌐 Internet back: the store server catches up within about 10 seconds.');
          }
        },
      });
      return;
    }

    console.log('\nSmoke test');
    check(health.app === 'tapntrade-store', 'the store server answers over HTTPS with the shop certificate');

    const owner = await call(CLOUD, 'POST', '/auth/login', { body: { email: 'owner@snack.test', password: 'owner123' } });
    check(owner.status === 201 || owner.status === 200, 'owner signs in to the cloud');
    const code = await call(CLOUD, 'POST', '/store-servers/pairing-codes', { token: owner.body.accessToken });
    check(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.body.code), `the cloud hands out a pairing code (${code.body.code})`);

    const paired = await call(STORE_HTTP, 'POST', '/api/local/pair', { body: { code: code.body.code } });
    check(paired.status === 200 && paired.body.storeName === 'Snack Dev', 'the store server pairs and copies the store');

    const list = await call(CLOUD, 'GET', '/store-servers', { token: owner.body.accessToken });
    const serverId = list.body.servers[0].id;
    const activated = await call(CLOUD, 'POST', `/store-servers/${serverId}/activate`, { token: owner.body.accessToken });
    check(activated.body.operationMode === 'server', 'the owner activates it');

    const synced = await call(STORE_HTTP, 'POST', '/api/local/sync-now');
    check(synced.body.writable === true, 'the store server learns it is the writer');

    const waiter = await call(STORE, 'POST', '/auth/login', { body: { email: 'waiter@snack.test', password: 'waiter123' } });
    check(!!waiter.body?.accessToken, 'the waiter signs in on the store server, with no cloud involved');

    const order = await call(STORE, 'POST', '/restaurant/orders', {
      token: waiter.body.accessToken,
      body: { orderType: 'dine_in', tableId: seed.tableId, items: [{ productId: seed.productId, quantity: 2 }] },
    });
    check(order.status === 201, `the waiter places an order on the store server (#${order.body?.orderSequence})`);

    await call(STORE_HTTP, 'POST', '/api/local/sync-now');
    const onCloud = await seed.db.query(`SELECT "orderSequence", total::float AS total FROM orders`);
    check(onCloud.rows.length === 1 && onCloud.rows[0].total === 900, 'the order reaches the cloud');

    const refused = await call(CLOUD, 'POST', '/restaurant/orders', {
      token: owner.body.accessToken,
      body: { orderType: 'takeaway', items: [{ productId: seed.productId, quantity: 1 }] },
    });
    check(refused.status === 409 && refused.body.code === 'STORE_SERVER_MODE', 'the cloud refuses to take orders for it');

    const staffOnCloud = await call(CLOUD, 'POST', '/auth/login', { body: { email: 'waiter@snack.test', password: 'waiter123' } });
    check(staffOnCloud.status === 409, 'staff cannot sign in to the cloud while the store runs its own server');

    const blocked = await call(STORE, 'POST', '/auth/register', { body: { email: 'x@y.z', password: 'whatever1', name: 'x' } });
    check(blocked.status === 404, 'cloud-only endpoints do not exist on the store server');

    const setupPage = await fetch(`${STORE_HTTP}/setup`).then((r) => r.text());
    check(setupPage.includes('Taking orders') && setupPage.includes('<svg'), 'the setup page shows the store taking orders, with the QR');

    const redirect = await fetch(`${STORE_HTTP}/api/products`, { redirect: 'manual' });
    check(redirect.status === 308, 'plain HTTP is sent to HTTPS');

    // Only when POS-Frontend's `npm run build:store` has been run.
    const page = await new Promise((resolve) =>
      https.get('https://localhost:8443/restaurant/orders', { ca: caPem }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      }),
    );
    if (page.status === 200) {
      check(page.text.includes('<div id="root">'), 'the store server serves the web app itself, deep links included');
    } else {
      console.log('  - web app not built (npm run build:store in POS-Frontend); skipped');
    }

    console.log('\nAll good.');
    await seed.db.end();
    await stopAll();
  } catch (error) {
    console.error(error.message ?? error);
    await stopAll();
    process.exit(1);
  }
}

main();
