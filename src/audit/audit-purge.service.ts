import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
// Exact-pinned in package.json; see order-sequence-reset.service.ts for why.
import { CronJob } from 'cron';
import { LessThan, Repository } from 'typeorm';
import { RefreshToken } from '../entities';
import { AuditService } from './audit.service';

/**
 * Keeps the audit table from growing without bound.
 *
 * Every write across every store lands in `audit_logs`, which on a busy
 * restaurant is thousands of rows a day. Each night rows older than
 * AUDIT_RETENTION_DAYS are deleted; the default keeps a quarter's worth,
 * which is what a dispute over a bill realistically needs. 0 keeps forever.
 *
 * The same tick clears expired refresh tokens, which `RefreshTokenService.
 * purgeExpired()` was written for but nothing had ever scheduled.
 *
 * Registered in onModuleInit rather than with `@Cron()` so ConfigService is
 * populated when the schedule is read — the same reasoning as
 * OrderSequenceResetService, which this mirrors.
 */
@Injectable()
export class AuditPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditPurgeService.name);

  static readonly JOB_NAME = 'audit-log-nightly-purge';
  static readonly DEFAULT_RETENTION_DAYS = 90;
  /** Below this the table would stop being useful as a record at all. */
  static readonly MIN_RETENTION_DAYS = 7;

  constructor(
    private readonly audit: AuditService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const days = this.retentionDays();

    const job = CronJob.from({
      // 03:00 UTC — the quietest hour for a Pakistan-based customer base.
      cronTime: '0 3 * * *',
      timeZone: 'UTC',
      onTick: () => {
        void this.purge();
      },
    });

    this.scheduler.addCronJob(AuditPurgeService.JOB_NAME, job);
    job.start();

    this.logger.log(
      days === 0
        ? 'Audit log retention: unlimited (AUDIT_RETENTION_DAYS=0); nightly job only clears expired refresh tokens'
        : `Audit log retention: ${days} days, purged nightly at 03:00 UTC`,
    );
  }

  onModuleDestroy(): void {
    this.scheduler.getCronJob(AuditPurgeService.JOB_NAME)?.stop();
  }

  /** Never throws: a timer has no caller to hand a failure to. */
  async purge(): Promise<void> {
    const days = this.retentionDays();
    try {
      if (days > 0) {
        const removed = await this.audit.purgeOlderThan(days);
        if (removed) this.logger.log(`Purged ${removed} audit row(s) older than ${days} days`);
      }
      const tokens = await this.refreshTokens.delete({ expiresAt: LessThan(new Date()) });
      if (tokens.affected) this.logger.log(`Purged ${tokens.affected} expired refresh token(s)`);
    } catch (error) {
      this.logger.error('Nightly audit purge failed; will retry tomorrow', error);
    }
  }

  /** 0 = keep forever; anything unparseable or too small falls back to the default. */
  retentionDays(): number {
    const raw = this.config.get<string>('AUDIT_RETENTION_DAYS');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return AuditPurgeService.DEFAULT_RETENTION_DAYS;
    }
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 0) {
      this.logger.error(
        `AUDIT_RETENTION_DAYS="${raw}" is not a whole number of days; using ${AuditPurgeService.DEFAULT_RETENTION_DAYS}`,
      );
      return AuditPurgeService.DEFAULT_RETENTION_DAYS;
    }
    if (days !== 0 && days < AuditPurgeService.MIN_RETENTION_DAYS) {
      this.logger.error(
        `AUDIT_RETENTION_DAYS=${days} is below the ${AuditPurgeService.MIN_RETENTION_DAYS}-day minimum; using it`,
      );
      return AuditPurgeService.MIN_RETENTION_DAYS;
    }
    return days;
  }
}
