import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * paired  — has its credential and is copying the store's data down.
 * active  — the store's writer: its orders are the orders.
 * fenced  — replaced by a failover; may only hand back what it still holds.
 * revoked — its credential no longer works.
 */
export type StoreServerStatus = 'paired' | 'active' | 'fenced' | 'revoked';

/**
 * A shop PC running the backend in store mode, as the cloud knows it.
 *
 * Lives in the cloud database. The table exists on store servers too, since
 * every database runs the same migrations, but stays empty there.
 */
@Entity('store_servers')
@Index('IDX_store_servers_store', ['storeId'])
export class StoreServer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 16, default: 'paired' })
  status: StoreServerStatus;

  /** SHA-256 of the secret the server authenticates with. The secret itself is never stored. */
  @Column({ type: 'varchar', length: 64 })
  credentialHash: string;

  /** stores.writerEpoch when this server last became the writer. */
  @Column({ type: 'int', default: 0 })
  epoch: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  hostname: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  version: string | null;

  /** Addresses the shop's devices can reach it at, e.g. https://192.168.1.20. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  lanUrls: string[];

  /** Fingerprint of the shop's own certificate authority, so devices can check what they install. */
  @Column({ type: 'varchar', length: 95, nullable: true })
  caSha256: string | null;

  /** Last heartbeat: pending changes, clock skew, disk, backups. */
  @Column({ type: 'jsonb', nullable: true })
  health: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
