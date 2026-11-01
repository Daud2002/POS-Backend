import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import * as os from 'os';
import { LEASE_DAYS } from '../../config/deployment';
import { ApplyService } from '../shared/apply.service';
import { readFeed } from '../shared/feed';
import { FeedPage, RowResult, StoreWriterState, WireDelta, WireRow } from '../shared/wire';
import { CloudClient, CloudError, CloudUnreachable, Timed } from './cloud-client';

export const DEFAULT_CLOUD_URL = 'https://api.tapntrade.store/api';
const PAGE = 500;
const CYCLE_MS = 10_000;

export interface SyncStateRow {
  server_id: string | null;
  store_id: string | null;
  credential: string | null;
  cloud_url: string | null;
  writable: boolean;
  epoch: number;
  clock_offset_ms: string;
  pull_after: string;
  pull_delta_after: string;
  push_after: string;
  push_delta_after: string;
  bootstrapped_at: Date | null;
  last_sync_at: Date | null;
  last_sync_error: string | null;
}

const VERSION: string = (() => {
  try {
    return require('../../../package.json').version;
  } catch {
    return 'unknown';
  }
})();

/**
 * The store server's half of the sync, run on the shop PC.
 *
 * Every cycle: push what changed here, pull what changed in the cloud, and
 * learn from the answer whether this server is the store's writer (only then
 * does it take orders). No internet simply means the cycle fails quietly and
 * the shop carries on; the next cycle that reaches the cloud catches up.
 */
@Injectable()
export class StoreSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StoreSyncService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private offsets: number[] = [];
  private cycles = 0;
  private reachable = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly apply: ApplyService,
  ) {}

  async onApplicationBootstrap() {
    // Tell the capture triggers this database is a store server's.
    await this.dataSource.query(
      `UPDATE sync_state SET role = 'store', node_id = COALESCE(server_id::text, 'unpaired')`,
    );
    if (process.env.TNT_SYNC_TIMER !== 'off') {
      this.timer = setInterval(() => void this.syncNow(), CYCLE_MS);
      void this.syncNow();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async state(m: EntityManager = this.dataSource.manager): Promise<SyncStateRow> {
    const [row] = await m.query(`SELECT * FROM sync_state`);
    return row;
  }

  private client(state: Pick<SyncStateRow, 'cloud_url' | 'credential'>) {
    return new CloudClient(state.cloud_url ?? process.env.CLOUD_API_URL ?? DEFAULT_CLOUD_URL, state.credential);
  }

  // --------------------------------------------------------------- pairing

  /**
   * Links this PC to a store with the owner's one-time code, then copies the
   * store's data down. Only on an empty server: re-pairing a used one would
   * mix two stores' data.
   */
  async pair(code: string, cloudUrl?: string) {
    const current = await this.state();
    if (current.bootstrapped_at) {
      throw new BadRequestException('This store server is already linked to a store.');
    }
    const url = (cloudUrl || process.env.CLOUD_API_URL || DEFAULT_CLOUD_URL).replace(/\/+$/, '');
    const { body } = await this.client({ cloud_url: url, credential: null }).post<{
      serverId: string;
      storeId: string;
      storeName: string;
      credential: string;
    }>('/store-servers/pair', {
      code,
      hostname: os.hostname(),
      version: VERSION,
      lanUrls: this.lanUrls(),
      caSha256: process.env.TNT_CA_SHA256 ?? null,
    });

    await this.dataSource.query(
      `UPDATE sync_state SET server_id = $1::uuid, store_id = $2::uuid, credential = $3, cloud_url = $4,
              node_id = $1::text, writable = false`,
      [body.serverId, body.storeId, body.credential, url],
    );
    const counts = await this.bootstrap();
    return { storeId: body.storeId, storeName: body.storeName, counts };
  }

  /** The first full copy, applied in one transaction: all of it or nothing. */
  async bootstrap() {
    const state = await this.state();
    if (!state.store_id) throw new BadRequestException('Pair this store server first.');
    const lines = await this.client(state).ndjson('/sync/bootstrap');
    const header = lines.find((l) => l.type === 'header');
    const end = lines.find((l) => l.type === 'end');
    if (!header || !end) throw new Error('The copy from the cloud was cut off. Try again.');

    const rows: WireRow[] = lines.filter((l) => l.type === 'rows').flatMap((l) => l.rows);
    const included: WireDelta[] = lines.find((l) => l.type === 'deltas-included')?.deltas ?? [];

    await this.dataSource.transaction(async (m) => {
      await this.apply.apply(m, rows, [], { side: 'store', storeId: state.store_id!, bootstrap: true });
      await this.apply.recordApplied(m, included, state.store_id!);
      await m.query(
        `UPDATE sync_state SET pull_after = $1, pull_delta_after = $2, bootstrapped_at = now(),
                last_cloud_time = $3::timestamptz`,
        [header.cursor, header.deltaCursor, header.serverTime],
      );
    });
    this.logger.log(`Copied the store from the cloud: ${JSON.stringify(end.counts)}`);
    return end.counts as Record<string, number>;
  }

  // ------------------------------------------------------------------ sync

  /** One cycle; concurrent calls share it. */
  syncNow(): Promise<void> {
    this.running ??= this.cycle().finally(() => (this.running = undefined));
    return this.running;
  }

  private async cycle() {
    const state = await this.state();
    if (!state.credential || !state.bootstrapped_at) return;
    const cloud = this.client(state);

    try {
      if (this.cycles++ % 6 === 0) await this.heartbeat(cloud);
      await this.push(cloud, state);
      await this.pull(cloud);
      await this.dataSource.transaction((m) => this.apply.retryParked(m, { side: 'store', storeId: state.store_id! }));
      this.reachable = true;
      await this.dataSource.query(`UPDATE sync_state SET last_sync_at = now(), last_sync_error = NULL`);
    } catch (error: any) {
      this.reachable = !(error instanceof CloudUnreachable);
      const message = error instanceof CloudUnreachable ? 'No connection to the cloud' : String(error?.message ?? error);
      await this.dataSource.query(`UPDATE sync_state SET last_sync_error = $1`, [message.slice(0, 500)]);
      if (!(error instanceof CloudUnreachable)) this.logger.warn(`Sync failed: ${message}`);
    }
  }

  private async push(cloud: CloudClient, initial: SyncStateRow) {
    let state = initial;
    for (;;) {
      const page: FeedPage = await this.dataSource.transaction('REPEATABLE READ', (m) =>
        readFeed(m, {
          storeId: state.store_id!,
          after: state.push_after,
          deltaAfter: state.push_delta_after,
          limit: PAGE,
          origin: { only: state.server_id! },
        }),
      );
      if (!page.rows.length && !page.deltas.length) return;

      const res = await cloud.post<{ results: RowResult[]; serverTime: string; store: StoreWriterState }>('/sync/push', {
        epoch: state.epoch,
        rows: page.rows,
        deltas: page.deltas,
      });
      for (const r of res.body.results.filter((x) => x.status === 'rejected')) {
        this.logger.warn(`Cloud rejected ${r.tbl} ${r.id}: ${r.reason}`);
      }
      await this.dataSource.query(`UPDATE sync_state SET push_after = $1, push_delta_after = $2`, [page.next, page.nextDelta]);
      await this.learn(res);
      state = await this.state();
      if (!page.hasMore) return;
    }
  }

  private async pull(cloud: CloudClient) {
    for (;;) {
      const state = await this.state();
      const res = await cloud.get<FeedPage & { serverTime: string; store: StoreWriterState }>(
        `/sync/pull?after=${encodeURIComponent(state.pull_after)}&deltaAfter=${encodeURIComponent(state.pull_delta_after)}&limit=${PAGE}`,
      );
      const page = res.body;
      await this.dataSource.transaction(async (m) => {
        await this.apply.apply(m, page.rows, page.deltas, { side: 'store', storeId: state.store_id! });
        await m.query(`UPDATE sync_state SET pull_after = $1, pull_delta_after = $2`, [page.next, page.nextDelta]);
      });
      await this.learn(res);
      if (!page.hasMore) return;
    }
  }

  private async heartbeat(cloud: CloudClient) {
    const { pendingChanges, parked, recentConflicts } = await this.status();
    const res = await cloud.post<{ serverTime: string; status: string; store: StoreWriterState }>('/sync/heartbeat', {
      version: VERSION,
      lanUrls: this.lanUrls(),
      health: {
        pendingChanges,
        parked,
        recentConflicts,
        clockOffsetMs: this.medianOffset(),
        freeMemMb: Math.round(os.freemem() / 1e6),
      },
    });
    await this.learn(res, res.body.status);
  }

  /**
   * What every answer from the cloud teaches: the time there (to correct this
   * PC's clock in sync stamps), and whether this server is the writer.
   */
  private async learn(res: Timed<{ serverTime: string; store: StoreWriterState }>, status?: string) {
    const cloudTime = Date.parse(res.body.serverTime);
    if (Number.isFinite(cloudTime)) {
      this.offsets = [...this.offsets.slice(-4), cloudTime - (res.sentAt + res.receivedAt) / 2];
    }
    const { store } = res.body;
    const [{ server_id }] = await this.dataSource.query(`SELECT server_id::text FROM sync_state`);
    const writable = store.operationMode === 'server' && store.writerServerId === server_id && status !== 'fenced';
    await this.dataSource.query(
      `UPDATE sync_state SET writable = $1, epoch = $2, clock_offset_ms = $3,
              last_cloud_time = GREATEST(COALESCE(last_cloud_time, '-infinity'), $4::timestamptz)`,
      [writable, store.writerEpoch, this.medianOffset(), res.body.serverTime],
    );
  }

  private medianOffset(): number {
    if (!this.offsets.length) return 0;
    const sorted = [...this.offsets].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
  }

  // ---------------------------------------------------------------- status

  /** Addresses the shop's devices can use to reach this PC. */
  lanUrls(): string[] {
    const port = process.env.HTTPS_PORT && process.env.HTTPS_PORT !== '443' ? `:${process.env.HTTPS_PORT}` : '';
    return Object.values(os.networkInterfaces())
      .flat()
      .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal)
      .map((n) => `https://${n.address}${port}`);
  }

  async status() {
    const state = await this.state();
    const [counts] = await this.dataSource.query(
      `SELECT (SELECT count(*) FROM sync_meta WHERE origin = $1
                 AND (xid, seq) > (split_part($2, '.', 1)::xid8, split_part($2, '.', 2)::bigint))::int AS "pendingChanges",
              (SELECT count(*) FROM sync_parked)::int AS parked,
              (SELECT count(*) FROM sync_conflicts WHERE at > now() - interval '7 days')::int AS "recentConflicts"`,
      [state.server_id ?? 'none', state.push_after],
    );
    return {
      paired: !!state.server_id,
      serverId: state.server_id,
      storeId: state.store_id,
      writable: state.writable,
      cloudReachable: this.reachable,
      lastSyncAt: state.last_sync_at,
      lastSyncError: state.last_sync_error,
      bootstrappedAt: state.bootstrapped_at,
      clockOffsetMs: this.medianOffset(),
      leaseExpired: this.leaseExpired(state),
      ...counts,
    };
  }

  /**
   * True when the cloud has not been reached for LEASE_DAYS. The store's
   * subscription and staff deactivations only arrive through the cloud, so a
   * PC kept offline forever must not keep a deactivated store running.
   */
  leaseExpired(state: Pick<SyncStateRow, 'bootstrapped_at' | 'last_sync_at'>): boolean {
    const last = state.last_sync_at ?? state.bootstrapped_at;
    if (!last) return false;
    return Date.now() - new Date(last).getTime() > LEASE_DAYS * 86_400_000;
  }
}

export { CloudError };
