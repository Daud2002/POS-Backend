import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /**
   * Legacy cosmetic label ('Café', 'Bakery', ...). Superseded by `accountType`
   * and no longer written by the UI. Deliberately NOT dropped: `synchronize`
   * runs against production, so removing it would issue a DROP COLUMN on
   * deploy. Retire it in its own dedicated release.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  type?: string;

  /**
   * Drives which product/order flow the tenant gets. `general` is the original
   * behaviour and the default, so every pre-existing store keeps working
   * untouched. Immutable once set — switching would strand tables and orders.
   */
  @Column({
    type: 'enum',
    enum: ['general', 'restaurant'],
    enumName: 'stores_account_type_enum',
    default: 'general',
  })
  accountType: 'general' | 'restaurant';

  /**
   * Counter behind the per-restaurant order number, which customers see as
   * 1, 2, 3… rather than a timestamp.
   *
   * It lives on the store (not a global sequence) so each restaurant counts
   * independently, and it is incremented with an atomic
   * `UPDATE … SET orderSequence = orderSequence + 1 … RETURNING` inside the
   * order transaction — a read-then-write would hand two concurrent waiters
   * the same number.
   *
   * The number starts again at 1 every morning (6am by default), so the
   * value is "last number issued TODAY", not a lifetime total. Nothing may
   * treat it as unique or monotonic across days.
   */
  @Column({ type: 'int', default: 0 })
  orderSequence: number;

  /**
   * The trading day `orderSequence` was last issued on (see
   * order-sequence-day.ts). The first order of a new day restarts the count
   * at 1 by comparing against this, so the reset no longer depends on a 6am
   * timer firing: a shop's own PC is often switched off at that hour, and a
   * missed cron tick is never run later. NULL until the first order after
   * this column was added; that one continues the count it found.
   */
  @Column({ type: 'date', nullable: true })
  orderSequenceDay: string | null;

  /**
   * 'cloud': orders are taken through api.tapntrade.store, as always.
   * 'server': the store runs on its own in-shop store server, which keeps
   * working without internet. The cloud then refuses to take orders, move
   * tables or open shifts for it (see src/sync), so there is only ever one
   * place writing them and order numbers, tables and drawers cannot clash.
   */
  @Column({ type: 'varchar', length: 16, default: 'cloud' })
  operationMode: 'cloud' | 'server';

  /** The store server allowed to write while in 'server' mode. */
  @Column({ type: 'uuid', nullable: true })
  writerServerId: string | null;

  /**
   * Bumped on every change of writer. A store server that comes back after
   * being replaced carries an older epoch, which is how it learns it no
   * longer owns the store.
   */
  @Column({ type: 'int', default: 0 })
  writerEpoch: number;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'starter',
  })
  plan: string;

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, default: 'BP-80' })
  printerConfig?: string;

  /**
   * Turns on cashier shifts for this tenant.
   *
   * Defaults to OFF so the release changes nothing for existing stores: with
   * it off, settling still records WHO took the money, but no one is blocked
   * for lacking an open shift. An owner opts in when their staff are ready,
   * because switching it on makes "open your shift" a precondition of taking
   * any payment.
   *
   * Restaurant tenants only for now — the general POS has no till widget yet.
   */
  @Column({ type: 'boolean', default: false })
  shiftsEnabled: boolean;

  /**
   * Tip recording, switched on per payment method.
   *
   * Some restaurants pool tips and share them out at day end; others only
   * care about card tips, or about none. With a method's flag on, the till
   * asks how much was received when a bill is paid that way, and whatever is
   * above the bill is stored as a tip (`Order.tipAmount`) — never as revenue.
   * All three off is the flow as it was before tips existed.
   *
   * Restaurant tenants only, like `shiftsEnabled`.
   */
  @Column({ type: 'boolean', default: false })
  tipsCashEnabled: boolean;

  @Column({ type: 'boolean', default: false })
  tipsCardEnabled: boolean;

  @Column({ type: 'boolean', default: false })
  tipsOnlineEnabled: boolean;

  /**
   * Whether card and online tips are paid to staff out of the cash drawer.
   *
   * ON: the cashier takes them from the drawer, so they come off the cash to
   * hand over. OFF: they stay with the card/online money and the handover is
   * untouched. Cash tips are kept out of the handover either way.
   */
  @Column({ type: 'boolean', default: false })
  tipsPaidFromCash: boolean;

  /**
   * Server-relative path to the tenant's logo, e.g. '/uploads/logo/<id>-<ts>.png'.
   *
   * Stored relative, never absolute: the API's public origin differs between
   * dev, mobile emulators and production, so clients join it onto their own
   * base URL rather than trusting a host baked in at upload time.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl?: string | null;

  /**
   * The logo bytes themselves, served by GET /stores/:id/logo.
   *
   * Kept in the database rather than on disk because production runs on a
   * container with an EPHEMERAL filesystem: every deploy started from a clean
   * image, so a logo written to `uploads/` vanished at the next release while
   * `logoUrl` kept pointing at it. The browser then received a JSON 404 where
   * it expected an image, which Chrome reports as ERR_BLOCKED_BY_ORB.
   *
   * `select: false` keeps the ~500 KB out of every ordinary `GET /stores/:id`
   * — both clients call that to build receipt headers, and neither wants the
   * image inline. Only the logo endpoint selects it explicitly.
   */
  @Column({ type: 'bytea', nullable: true, select: false })
  logoData?: Buffer | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  logoMimeType?: string | null;

  /**
   * The last day the tenant's subscription is paid through ('YYYY-MM-DD'),
   * or null when the platform admin has never recorded a payment — which is
   * what every pre-existing store has, so this release shows no warning
   * anywhere until a date is entered on the Subscriptions page.
   *
   * A calendar DATE, not a timestamp: there is no timezone on the store, and
   * "paid through the 21st" must mean the 21st wherever the owner is. The
   * dashboards count whole days to it (yellow at 3, red at 1) and the history
   * of how it got here is `subscription_payments`.
   *
   * Nullable with no default on purpose: `synchronize` runs against
   * production, and that is the one kind of column it can add safely.
   */
  @Column({ type: 'date', nullable: true })
  subscriptionExpiresAt?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  owner: User;
}
