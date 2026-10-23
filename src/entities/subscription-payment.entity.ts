import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A payment the platform admin recorded against a store's subscription.
 *
 * `stores.subscriptionExpiresAt` always holds the current answer; this table
 * is how it got there — every extension, by whom, from what date to what
 * date — so a dispute over "we paid for six months" can be settled.
 *
 * Calendar DATEs, as on the store: a subscription is paid through a day, not
 * an instant. No foreign key to `stores`, which are hard-deleted; the record
 * of what was paid must survive the store.
 */
@Entity('subscription_payments')
export class SubscriptionPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  storeId: string;

  /** What the store was paid through before this payment; null when it had no date. */
  @Column({ type: 'date', nullable: true })
  previousExpiresAt?: string | null;

  @Column({ type: 'date' })
  newExpiresAt: string;

  /** The preset chosen, or null when the admin typed an exact date instead. */
  @Column({ type: 'int', nullable: true })
  months?: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  adminId?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  adminName?: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
