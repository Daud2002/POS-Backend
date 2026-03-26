import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from 'typeorm';

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  employeeId: string; // Custom employee ID like EMP001, EMP002

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  salary?: number;

  @Column({ type: 'date', nullable: true })
  joinDate?: Date;

  @Column({ type: 'varchar', length: 50, default: 'cashier' })
  designation: 'cashier' | 'manager' | 'staff'; // Employee role/position

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne('Store')
  @JoinColumn({ name: 'storeId' })
  store: any;

  @OneToOne('User')
  @JoinColumn({ name: 'userId' })
  user: any;
}
