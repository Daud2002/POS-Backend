import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

export type OrderStatus = 'pending' | 'paid' | 'unpaid' | 'cancelled' | 'refunded';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  storeId: string;

  @Column({ unique: true })
  orderNumber: string;

  @Column('uuid', { nullable: true })
  customerId: string;

  @ManyToOne('Customer', 'orders')
  @JoinColumn({ name: 'customerId' })
  customer: any;

  @Column({ nullable: true })
  customerName: string;

  @ManyToOne('User', 'orders')
  @JoinColumn({ name: 'createdById' })
  createdBy: any;

  @Column('uuid')
  createdById: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'paid', 'unpaid', 'cancelled', 'refunded'],
    default: 'unpaid',
  })
  status: OrderStatus;


  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: number;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany('OrderItem', 'order', {
    cascade: true,
    eager: true,
  })
  items: any[];
}
