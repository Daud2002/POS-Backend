import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A one-time code an owner types into a new store server to link it to
 * their store. Short-lived and single-use; only its hash is kept, so a
 * leaked database cannot be used to pair a rogue server.
 */
@Entity('store_pairing_codes')
@Index('UQ_store_pairing_codes_hash', ['codeHash'], { unique: true })
export class StorePairingCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
