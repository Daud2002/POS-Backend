import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AuditLog } from '../entities';
import { toPage, type Page } from '../common/pagination';
import { knownAuditActions, SUMMARY_MAX_LENGTH } from './audit-routes';

export type NewAuditLog = Omit<AuditLog, 'id' | 'createdAt'>;

export interface AuditQuery {
  storeId?: string;
  module?: string;
  action?: string;
  actorId?: string;
  /** Instants (ISO); a bare 'YYYY-MM-DD' is taken as a whole UTC day. */
  from?: string;
  to?: string;
  search?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
  ) {}

  /**
   * Writes one row. Never throws and is never awaited by a request handler:
   * a failed audit insert must not fail — or slow — the order it describes.
   */
  async log(entry: NewAuditLog): Promise<void> {
    try {
      await this.auditLogs.insert({
        ...entry,
        summary: String(entry.summary ?? entry.action).slice(0, SUMMARY_MAX_LENGTH),
        module: String(entry.module).slice(0, 40),
        action: String(entry.action).slice(0, 80),
        path: String(entry.path ?? '').slice(0, 200),
      });
    } catch (error) {
      this.logger.warn(
        `Audit row not written (${entry.module}/${entry.action}): ${(error as Error)?.message ?? error}`,
      );
    }
  }

  async query(filters: AuditQuery, paging: { skip: number; take: number }): Promise<Page<AuditLog>> {
    const qb = this.auditLogs.createQueryBuilder('log').orderBy('log.createdAt', 'DESC');

    if (filters.storeId) qb.andWhere('log.storeId = :storeId', { storeId: filters.storeId });
    if (filters.module) qb.andWhere('log.module = :module', { module: filters.module });
    if (filters.action) qb.andWhere('log.action = :action', { action: filters.action });
    if (filters.actorId) qb.andWhere('log.actorId = :actorId', { actorId: filters.actorId });

    const from = parseInstant(filters.from, 'start');
    if (from) qb.andWhere('log.createdAt >= :from', { from });
    const to = parseInstant(filters.to, 'end');
    if (to) qb.andWhere('log.createdAt <= :to', { to });

    const term = filters.search?.trim();
    if (term) {
      qb.andWhere(
        `("log"."summary" ILIKE :term OR COALESCE("log"."actorName", '') ILIKE :term OR "log"."action" ILIKE :term OR "log"."path" ILIKE :term)`,
        { term: `%${term}%` },
      );
    }

    const [items, total] = await qb.skip(paging.skip).take(paging.take).getManyAndCount();
    return toPage(items, total, paging.skip, paging.take);
  }

  /** One row WITH its payload, which the list deliberately leaves out. */
  async findOne(id: string): Promise<AuditLog | null> {
    return this.auditLogs
      .createQueryBuilder('log')
      .addSelect('log.payload')
      .where('log.id = :id', { id })
      .getOne();
  }

  /**
   * Modules and actions for the filter dropdowns: everything the route table
   * knows, plus whatever unmapped writes have actually been recorded.
   */
  async filters(): Promise<{ modules: string[]; actions: Record<string, string[]> }> {
    const actions: Record<string, Set<string>> = {};
    for (const [module, list] of Object.entries(knownAuditActions())) {
      actions[module] = new Set(list);
    }

    try {
      const rows = await this.auditLogs
        .createQueryBuilder('log')
        .select('log.module', 'module')
        .addSelect('log.action', 'action')
        .distinct(true)
        .getRawMany<{ module: string; action: string }>();
      for (const row of rows) {
        if (!row.module || !row.action) continue;
        (actions[row.module] ??= new Set()).add(row.action);
      }
    } catch (error) {
      this.logger.warn(`Could not read recorded audit actions: ${(error as Error)?.message ?? error}`);
    }

    const modules = Object.keys(actions).sort();
    return {
      modules,
      actions: Object.fromEntries(modules.map((m) => [m, [...actions[m]].sort()])),
    };
  }

  /** Housekeeping: rows older than `days` are gone for good. */
  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.auditLogs.delete({ createdAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }
}

function parseInstant(value: string | undefined, edge: 'start' | 'end'): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = new Date(dayOnly ? `${trimmed}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z` : trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}
