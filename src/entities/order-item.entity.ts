import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column('uuid')
  orderId: string;

  @ManyToOne(() => Product, (product) => product.orderItems)
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column('uuid')
  productId: string;

  @Column({ nullable: true })
  productName: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  /**
   * Snapshot of `product.costPrice` at the moment this line was created.
   * Profit must not be recomputed from the live product: editing a cost
   * tomorrow would silently rewrite the margin on every past order.
   *
   * `product.costPrice` is nullable and legacy rows hold NULL, so callers
   * store `costPrice ?? 0` and report how many lines had unknown cost rather
   * than presenting a confidently wrong profit figure.
   */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  unitCost?: number;

  /** Kitchen instructions for this line — "no onions", "extra spicy". */
  @Column({ type: 'text', nullable: true })
  notes?: string;

  /**
   * When this line was sent to the kitchen. Set per round, so appending a
   * second round to a live order prints a ticket containing only the new
   * lines instead of reprinting the whole order. NULL while still a draft.
   */
  @Column({ type: 'timestamp', nullable: true })
  sentAt?: Date;
}
