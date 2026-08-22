import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  VersionColumn,
  Index,
} from 'typeorm';
import { Customer } from './customer.entity';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';
import { RestaurantTable } from './restaurant-table.entity';

export type OrderStatus = 'pending' | 'paid' | 'unpaid' | 'cancelled' | 'refunded' | 'completed';

/** Restaurant lifecycle. 'none' means "this is not a restaurant order". */
export type RestaurantOrderStatus =
  | 'none'
  | 'draft'
  | 'requested'
  | 'preparing'
  | 'completed'
  | 'cancelled';

export type OrderType = 'none' | 'dine_in' | 'takeaway' | 'delivery';

/** Restaurant order states that occupy a table. */
export const LIVE_ORDER_STATUSES: RestaurantOrderStatus[] = ['requested', 'preparing'];

/**
 * Enforces "at most one live order per table" in the schema rather than in
 * application code. Partial unique indexes ignore NULLs in Postgres, so every
 * existing (general-mode) row with tableId = NULL is unaffected.
 */
@Entity('orders')
@Index('UQ_orders_live_table', ['tableId'], {
  unique: true,
  where: `"orderStatus" IN ('requested', 'preparing')`,
})
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  storeId: string;

  /**
   * Globally unique internal identifier (`ORD-<ts>-<rand>`).
   *
   * Kept unique across ALL stores because the column carries a global UNIQUE
   * index. Restaurants display `orderSequence` instead — two restaurants both
   * having an order "1" is expected, and would collide here.
   */
  @Column({ unique: true })
  orderNumber: string;

  /**
   * The number the restaurant actually shows: 1, 2, 3… per store.
   * Null for general-account orders, which keep using `orderNumber`.
   */
  @Column({ type: 'int', nullable: true })
  orderSequence?: number;

  @Column('uuid', { nullable: true })
  customerId: string;

  @ManyToOne(() => Customer, (customer) => customer.orders)
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ nullable: true })
  customerName: string;

  /**
   * Contact details for takeaway/delivery, captured inline rather than as a
   * Customer row: `customers` has no storeId, so it is shared across every
   * tenant and writing walk-in details there leaks them between restaurants.
   */
  @Column({ nullable: true })
  customerPhone?: string;

  @Column({ type: 'text', nullable: true })
  deliveryAddress?: string;

  @ManyToOne(() => User, (user) => user.orders)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column('uuid')
  createdById: string;

  /**
   * PAYMENT status. Exposed to newer clients as `paymentStatus` via a response
   * alias; the column keeps this name deliberately.
   *
   * DO NOT RENAME. `synchronize: true` runs against production, and TypeORM's
   * rename detection only fires when the net column count is unchanged with
   * exactly one unmatched column on each side. Renaming this alongside any
   * other column change silently degrades into DROP COLUMN + ADD COLUMN,
   * destroying the payment status of every historical order.
   *
   * Note there is no 'draft' member: a restaurant draft is
   * `status: 'unpaid'` + `orderStatus: 'draft'`.
   */
  @Column({
    type: 'enum',
    enum: ['pending', 'paid', 'unpaid', 'cancelled', 'refunded', 'completed'],
    default: 'unpaid',
  })
  status: OrderStatus;

  /**
   * Restaurant lifecycle, orthogonal to payment. NOT NULL with an explicit
   * 'none' member rather than nullable: in Postgres `WHERE orderStatus <> 'x'`
   * silently drops NULL rows, which would turn every existing general-mode
   * query into a three-valued-logic hazard.
   */
  @Column({
    type: 'enum',
    enum: ['none', 'draft', 'requested', 'preparing', 'completed', 'cancelled'],
    enumName: 'orders_order_status_enum',
    default: 'none',
  })
  orderStatus: RestaurantOrderStatus;

  @Column({
    type: 'enum',
    enum: ['none', 'dine_in', 'takeaway', 'delivery'],
    enumName: 'orders_order_type_enum',
    default: 'none',
  })
  orderType: OrderType;

  @Column('uuid', { nullable: true })
  tableId?: string;

  @ManyToOne(() => RestaurantTable, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tableId' })
  table?: RestaurantTable;


  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax: number;

  /** The resolved discount AMOUNT actually taken off this order. */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: number;

  /**
   * How the discount was entered, and the raw figure entered. Storing the
   * input alongside the computed amount is what lets a receipt say "25% off"
   * instead of just "-250". Applies to both account types — the general POS
   * already computes a percentage and throws the input away.
   */
  @Column({
    type: 'enum',
    enum: ['amount', 'percent'],
    enumName: 'orders_discount_type_enum',
    nullable: true,
  })
  discountType?: 'amount' | 'percent';

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  discountValue?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  @Column({ nullable: true })
  notes: string;

  @Column({
    type: 'enum',
    enum: ['cash', 'card', 'check', 'online'],
    default: 'cash',
    nullable: true,
  })
  paymentMethod: 'cash' | 'card' | 'check' | 'online';

  /**
   * Optimistic lock. Drafts are shared across waiters, so two people can open
   * the same one; a stale write bumps into this and gets a 409 instead of
   * silently clobbering the other waiter's lines.
   */
  /**
   * `default: 1` is load-bearing, not cosmetic. Without it TypeORM emits
   * `ADD "version" integer NOT NULL` with no default, which fails outright on
   * a table that already has rows — taking the whole API down at boot, since
   * synchronize runs during startup.
   */
  @VersionColumn({ default: 1 })
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => OrderItem, (item) => item.order, {
    cascade: true,
    eager: true,
  })
  items: OrderItem[];
}
