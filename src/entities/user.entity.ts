import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ default: 'user' })
  role: 'admin' | 'cashier' | 'store_owner' | 'employee' | 'customer';

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany('Order', 'createdBy')
  orders: any[];

  @OneToOne('Store', 'owner', { nullable: true })
  store?: any;
}
