import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * One issued refresh token.
 *
 * The raw token never reaches this table — only its SHA-256 hash — so a
 * database leak cannot be replayed against /auth/refresh.
 *
 * Tokens form a "family": every rotation links the old row to its replacement
 * via `replacedById`. Presenting a token that has already been rotated means
 * it was captured, so the whole family is revoked rather than just that row.
 */
@Entity('refresh_tokens')
@Index(['userId', 'expiresAt'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** SHA-256 of the opaque token. Unique so a hash collision can't be reused. */
  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  /** Shared by every token descended from one login. Revoked as a unit. */
  @Column({ type: 'uuid' })
  @Index()
  familyId: string;

  /** Absolute 7-day cutoff. Rotation does NOT extend it — the user re-logs in. */
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  /** Set on rotation. Its presence is what makes reuse detectable. */
  @Column({ type: 'uuid', nullable: true })
  replacedById?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
