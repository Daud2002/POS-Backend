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

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  storeId: string;

  @Column({ unique: true })
  orderNumber: string;

  @ManyToOne('Customer', 'orders', { nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer: any;

  @Column('uuid', { nullable: true })
  customerId: string;

  @ManyToOne('User', 'orders')
  @JoinColumn({ name: 'createdById' })
  createdBy: any;

  @Column('uuid')
  createdById: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'completed', 'cancelled', 'refunded'],
    default: 'completed',
  })
  status: 'pending' | 'completed' | 'cancelled' | 'refunded';

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
