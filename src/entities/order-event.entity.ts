import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Order } from './order.entity';

/**
 * What happened to an order, in the order it happened.
 *
 * 'placed'         the lines first sent to the kitchen (the "original order")
 * 'items_added'    a further round — payload.lines are the NEW lines only
 * 'items_removed'  lines taken off — payload.lines carry the quantity removed
 * 'bill_printed'   the bill went to paper; `reprint` says whether it was a repeat
 *
 * A plain string union, and a varchar column below, on purpose: a Postgres
 * enum here would need the rename-and-retype dance every time a kind is
 * added, and `orders.orderStatus` already shows how that ends under
 * `synchronize`.
 */
export type OrderEventType = 'placed' | 'items_added' | 'items_removed' | 'bill_printed';

/** One line as it was at the moment of the event. Numbers, never decimal strings. */
export interface OrderEventLine {
  /** The `order_items.id` this line had. Absent on lines that no longer exist. */
  orderItemId?: string | null;
  productId: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  isParcel: boolean;
  notes: string | null;
  skipKitchen: boolean;
}

export interface OrderEventTotals {
  subtotal: number;
  discount: number;
  discountType: 'amount' | 'percent' | null;
  discountValue: number | null;
  deliveryCharge: number;
  total: number;
}

export interface OrderEventPayload {
  lines: OrderEventLine[];
  /** The order's money AFTER this event. */
  totals: OrderEventTotals;
  /** bill_printed only. */
  reprint?: boolean;
  printNumber?: number;
  /** items_removed only: where the kitchen lifecycle landed afterwards. */
  orderStatusAfter?: string;
}

/**
 * The audit trail of a restaurant order.
 *
 * Every write that changes what the customer is charged for, and every print
 * of the bill, appends a row here IN THE SAME TRANSACTION as the change. The
 * order row itself always shows the current state; this table is how the
 * owner sees the original order, who changed it, and how many times the
 * paper came out.
 *
 * Rows are immutable snapshots, in the manner of `CashierShift`: the actor's
 * name is copied in rather than joined, so renaming or deleting a cashier
 * later does not rewrite who did what. `payload` is jsonb for the same reason
 * `Employee.permissions` is — one column, no schema churn per event kind.
 */
@Entity('order_events')
export class OrderEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  orderId: string;

  /**
   * Cascade is a safety net only. Drafts are the one thing hard-deleted, and
   * a draft never earns an event — but if an order row ever does go, its
   * history must not be left dangling.
   */
  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order?: Order;

  @Column('uuid')
  storeId: string;

  @Column({ type: 'varchar', length: 32 })
  type: OrderEventType;

  /** Audit only. Null for system-originated rows or a since-deleted user. */
  @Column({ type: 'uuid', nullable: true })
  actorId?: string | null;

  /**
   * Explicit `type: 'varchar'` on every nullable string: a `string | null`
   * property reflects as Object, which TypeORM cannot map to a column.
   */
  @Column({ type: 'varchar', length: 150, nullable: true })
  actorName?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  actorRole?: string | null;

  @Column({ type: 'jsonb' })
  payload: OrderEventPayload;

  @CreateDateColumn()
  createdAt: Date;
}
