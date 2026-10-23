import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per successful write anywhere in the API — an order punched, a
 * discount applied, a bill settled, a product edited, an employee deactivated,
 * a subscription extended, an admin signing in as a store.
 *
 * Written by AuditInterceptor from the request itself rather than by each
 * service, so a route added next month is covered without anyone remembering
 * to log it; `audit-routes.ts` turns the raw method + path into the module,
 * action and one-line summary the platform admin reads.
 *
 * Deliberately has NO foreign keys. Stores, owners and employees are
 * hard-deleted today, and the trail of what they did must outlive them.
 * Names are copied in for the same reason (as `OrderEvent` does).
 *
 * `payload` carries the sanitised request body and is `select: false`: the
 * list screen pages through thousands of these and wants none of it, and the
 * detail dialog asks for it by id. Explicit `type: 'varchar'` on every
 * nullable string: a `string | null` property reflects as Object, which
 * TypeORM cannot map to a column.
 */
@Entity('audit_logs')
@Index(['storeId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null for platform-level actions (a store created, an admin signing in). */
  @Column({ type: 'uuid', nullable: true })
  storeId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  actorId?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  actorName?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  actorRole?: string | null;

  /** The platform admin behind the action when it was done via impersonation. */
  @Column({ type: 'uuid', nullable: true })
  impersonatorId?: string | null;

  @Column({ type: 'varchar', length: 40 })
  module: string;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  entityType?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId?: string | null;

  @Column({ type: 'varchar', length: 300 })
  summary: string;

  @Column({ type: 'varchar', length: 8 })
  method: string;

  @Column({ type: 'varchar', length: 200 })
  path: string;

  @Column({ type: 'int' })
  statusCode: number;

  @Column({ type: 'jsonb', nullable: true, select: false })
  payload?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
