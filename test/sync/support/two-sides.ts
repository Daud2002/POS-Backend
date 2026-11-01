import { DataSource } from 'typeorm';
import { Store, StorePairingCode, StoreServer } from '../../../src/entities';
import { ApplyService } from '../../../src/sync/shared/apply.service';
import { CloudSyncService } from '../../../src/sync/cloud/cloud-sync.service';
import { StoreServersService } from '../../../src/sync/cloud/store-servers.service';
import { sha256 } from '../../../src/sync/cloud/store-server-auth.guard';
import { StoreSyncService } from '../../../src/sync/store/store-sync.service';
import { freshDatabase } from '../../support/pg';

/**
 * A cloud database and a store server database, with the real services on
 * both ends and an in-memory "internet" between them: the store server's
 * fetch() calls go straight to the cloud services. `offline = true` cuts it.
 */
export class TwoSides {
  cloud!: DataSource;
  store!: DataSource;
  servers!: StoreServersService;
  cloudSync!: CloudSyncService;
  storeSync!: StoreSyncService;
  offline = false;
  private realFetch = globalThis.fetch;

  async start(name: string) {
    process.env.TNT_SYNC_TIMER = 'off';
    this.cloud = new DataSource(await freshDatabase('cloud', `${name}_cloud`));
    this.store = new DataSource(await freshDatabase('store', `${name}_store`));
    await Promise.all([this.cloud.initialize(), this.store.initialize()]);
    await Promise.all([this.cloud.runMigrations(), this.store.runMigrations()]);

    this.servers = new StoreServersService(
      this.cloud.getRepository(StoreServer),
      this.cloud.getRepository(StorePairingCode),
      this.cloud.getRepository(Store),
      this.cloud,
    );
    this.cloudSync = new CloudSyncService(this.cloud, new ApplyService(), this.servers);
    this.storeSync = new StoreSyncService(this.store, new ApplyService());
    await this.storeSync.onApplicationBootstrap();

    globalThis.fetch = ((url: string, init: RequestInit) => this.route(url, init)) as typeof fetch;
  }

  async stop() {
    globalThis.fetch = this.realFetch;
    await Promise.all([this.cloud?.destroy(), this.store?.destroy()]);
  }

  /** Push and pull until neither side has anything left to send. */
  async sync() {
    await this.storeSync.syncNow();
    await this.storeSync.syncNow();
  }

  private async route(url: string, init: RequestInit): Promise<Response> {
    if (this.offline) throw new TypeError('fetch failed');
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api/, '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const server = await this.authenticate((init.headers as Record<string, string>)?.Authorization);
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

    try {
      switch (`${init.method} ${path}`) {
        case 'POST /store-servers/pair':
          return json(await this.servers.pair(body));
        case 'GET /sync/bootstrap': {
          let text = '';
          const res: any = {
            headersSent: false,
            setHeader: () => (res.headersSent = true),
            write: (chunk: string) => (text += chunk),
            end: (): void => undefined,
          };
          await this.cloudSync.bootstrap(server!, res);
          return new Response(text, { status: 200 });
        }
        case 'GET /sync/pull':
          return json(
            await this.cloudSync.pull(
              server!,
              u.searchParams.get('after')!,
              u.searchParams.get('deltaAfter')!,
              Number(u.searchParams.get('limit')),
            ),
          );
        case 'POST /sync/push':
          return json(await this.cloudSync.push(server!, body));
        case 'POST /sync/heartbeat':
          await this.servers.heartbeat(server!, body);
          return json({
            serverTime: new Date().toISOString(),
            status: server!.status,
            store: await this.servers.writerStateOf(server!.storeId),
          });
      }
      return new Response(JSON.stringify({ message: `No route ${init.method} ${path}` }), { status: 404 });
    } catch (error: any) {
      return new Response(JSON.stringify({ message: error?.message }), { status: error?.status ?? 500 });
    }
  }

  private async authenticate(header?: string) {
    const match = /^StoreServer ([0-9a-f-]{36})\.(.+)$/.exec(header ?? '');
    if (!match) return null;
    const server = await this.cloud.getRepository(StoreServer).findOne({ where: { id: match[1] } });
    if (!server || server.credentialHash !== sha256(match[2]) || server.status === 'revoked') {
      throw Object.assign(new Error('Unknown store server'), { status: 401 });
    }
    return server;
  }
}

/** A restaurant on the cloud with an owner, a waiter, a table and a small menu. */
export async function seedRestaurant(db: DataSource) {
  const [owner] = await db.query(
    `INSERT INTO users (email, "passwordHash", role, name) VALUES ('owner-' || gen_random_uuid() || '@example.com', 'hash', 'store_owner', 'Owner') RETURNING id`,
  );
  const [store] = await db.query(
    `INSERT INTO stores (name, "userId", "accountType", currency) VALUES ('Snack Test', $1, 'restaurant', 'PKR') RETURNING id`,
    [owner.id],
  );
  const [waiter] = await db.query(
    `INSERT INTO users (email, "passwordHash", role, name) VALUES ('waiter-' || gen_random_uuid() || '@example.com', 'hash', 'employee', 'Waiter') RETURNING id`,
  );
  await db.query(
    `INSERT INTO employee_details ("storeId", "userId", "employeeId", name, email, designation) VALUES ($1, $2, 'W1', 'Waiter', 'w@example.com', 'waiter')`,
    [store.id, waiter.id],
  );
  const [category] = await db.query(
    `INSERT INTO categories ("storeId", name, "sortOrder") VALUES ($1, 'Burgers', 1) RETURNING id`,
    [store.id],
  );
  const [product] = await db.query(
    `INSERT INTO products ("storeId", "categoryId", name, price, stock) VALUES ($1, $2, 'Zinger', 450, 20) RETURNING id`,
    [store.id, category.id],
  );
  const [table] = await db.query(`INSERT INTO restaurant_tables ("storeId", name) VALUES ($1, 'T1') RETURNING id`, [
    store.id,
  ]);
  return { ownerId: owner.id, storeId: store.id, waiterId: waiter.id, categoryId: category.id, productId: product.id, tableId: table.id };
}
