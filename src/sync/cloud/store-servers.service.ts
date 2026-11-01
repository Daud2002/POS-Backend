import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomInt } from 'crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { Store, StorePairingCode, StoreServer } from '../../entities';
import { StoreWriterState } from '../shared/wire';
import { sha256 } from './store-server-auth.guard';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_TTL_MS = 10 * 60 * 1000;

export const normalizeCode = (code: string) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface PairRequest {
  code: string;
  hostname?: string;
  version?: string;
  lanUrls?: string[];
  caSha256?: string;
}

/**
 * The cloud's side of a store's in-shop server: pairing one, making it the
 * store's writer, and taking that back (failover) when the PC dies.
 */
@Injectable()
export class StoreServersService {
  constructor(
    @InjectRepository(StoreServer) private readonly servers: Repository<StoreServer>,
    @InjectRepository(StorePairingCode) private readonly codes: Repository<StorePairingCode>,
    @InjectRepository(Store) private readonly stores: Repository<Store>,
    private readonly dataSource: DataSource,
  ) {}

  /** A one-time code the owner types into the new server. Shown once; only its hash is kept. */
  async createPairingCode(storeId: string, userId: string) {
    const raw = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.codes.save(this.codes.create({ storeId, codeHash: sha256(raw), expiresAt, createdById: userId }));
    return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
  }

  /**
   * Trades a pairing code for a credential. The server is `paired`, not yet
   * the writer: it copies the store down first, and the owner activates it.
   */
  async pair(body: PairRequest) {
    const codeHash = sha256(normalizeCode(body.code));
    return this.dataSource.transaction(async (m) => {
      const code = await m.getRepository(StorePairingCode).findOne({
        where: { codeHash, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!code) throw new BadRequestException('That pairing code is wrong or has expired. Generate a new one.');
      code.usedAt = new Date();
      await m.save(code);

      const secret = randomBytes(32).toString('base64url');
      const server = await m.getRepository(StoreServer).save(
        m.getRepository(StoreServer).create({
          storeId: code.storeId,
          credentialHash: sha256(secret),
          hostname: body.hostname?.slice(0, 120) ?? null,
          version: body.version?.slice(0, 40) ?? null,
          lanUrls: sanitizeUrls(body.lanUrls),
          caSha256: body.caSha256?.slice(0, 95) ?? null,
          lastSeenAt: new Date(),
        }),
      );
      const store = await m.getRepository(Store).findOneOrFail({ where: { id: code.storeId } });
      return { serverId: server.id, storeId: store.id, storeName: store.name, credential: `${server.id}.${secret}` };
    });
  }

  async list(storeId: string) {
    const store = await this.store(storeId);
    const servers = await this.servers.find({ where: { storeId }, order: { createdAt: 'DESC' } });
    return {
      operationMode: store.operationMode,
      writerServerId: store.writerServerId,
      servers: servers.map(({ credentialHash: _hidden, ...s }) => s),
    };
  }

  /**
   * Makes `serverId` the store's writer. From here the cloud refuses to take
   * orders for this store; any other server of the store is fenced.
   */
  async activate(storeId: string, serverId: string) {
    return this.dataSource.transaction(async (m) => {
      const server = await this.serverOf(m, storeId, serverId);
      if (server.status === 'revoked') throw new BadRequestException('That store server was removed. Pair it again.');
      const store = await m.getRepository(Store).findOneOrFail({ where: { id: storeId }, lock: { mode: 'pessimistic_write' } });
      if (store.operationMode === 'server' && store.writerServerId === serverId) return this.writerState(store);

      store.operationMode = 'server';
      store.writerServerId = serverId;
      store.writerEpoch += 1;
      await m.getRepository(Store).update(storeId, {
        operationMode: store.operationMode,
        writerServerId: serverId,
        writerEpoch: store.writerEpoch,
      });
      await m.getRepository(StoreServer).update({ storeId, status: 'active' }, { status: 'fenced' });
      await m.getRepository(StoreServer).update(serverId, { status: 'active', epoch: store.writerEpoch });
      return this.writerState(store);
    });
  }

  /**
   * Takes the store back to the cloud, e.g. when the shop PC is dead. If the
   * old server comes back it learns it was replaced, stops taking orders, and
   * hands over whatever it still held.
   */
  async failover(storeId: string, serverId?: string) {
    return this.dataSource.transaction(async (m) => {
      const store = await m.getRepository(Store).findOneOrFail({ where: { id: storeId }, lock: { mode: 'pessimistic_write' } });
      if (serverId) await this.serverOf(m, storeId, serverId);
      store.operationMode = 'cloud';
      store.writerServerId = null;
      store.writerEpoch += 1;
      await m.getRepository(Store).update(storeId, { operationMode: 'cloud', writerServerId: null, writerEpoch: store.writerEpoch });
      await m.getRepository(StoreServer).update({ storeId, status: 'active' }, { status: 'fenced' });
      return this.writerState(store);
    });
  }

  async revoke(storeId: string, serverId: string) {
    const store = await this.store(storeId);
    if (store.writerServerId === serverId) await this.failover(storeId, serverId);
    await this.servers.update({ id: serverId, storeId }, { status: 'revoked' });
    return { revoked: true };
  }

  async heartbeat(server: StoreServer, body: { version?: string; lanUrls?: string[]; health?: Record<string, unknown> }) {
    await this.servers.update(server.id, {
      version: body.version?.slice(0, 40) ?? server.version,
      lanUrls: body.lanUrls ? sanitizeUrls(body.lanUrls) : server.lanUrls,
      health: body.health ?? null,
      lastSeenAt: new Date(),
    });
  }

  /** What a phone needs to find its store's server on the shop Wi-Fi. */
  async discover(storeId: string) {
    const store = await this.store(storeId);
    const server = store.writerServerId ? await this.servers.findOne({ where: { id: store.writerServerId } }) : null;
    return {
      operationMode: store.operationMode,
      server: server
        ? { id: server.id, lanUrls: server.lanUrls, caSha256: server.caSha256, lastSeenAt: server.lastSeenAt }
        : null,
    };
  }

  async writerStateOf(storeId: string): Promise<StoreWriterState> {
    return this.writerState(await this.store(storeId));
  }

  private writerState(store: Store): StoreWriterState {
    return { operationMode: store.operationMode, writerServerId: store.writerServerId, writerEpoch: store.writerEpoch };
  }

  private async store(storeId: string) {
    const store = await this.stores.findOne({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async serverOf(m: DataSource['manager'], storeId: string, serverId: string) {
    const server = await m.getRepository(StoreServer).findOne({ where: { id: serverId, storeId } });
    if (!server) throw new NotFoundException('Store server not found');
    return server;
  }
}

/** Only addresses a device on the shop's own network could use. */
function sanitizeUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\/[A-Za-z0-9.\-\[\]:]+(:\d+)?\/?$/.test(u))
    .slice(0, 8);
}
