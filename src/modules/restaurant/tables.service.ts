import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { RestaurantTable } from '../../entities';
import { CreateTableDto, UpdateTableDto } from './dto';
import { RealtimeGateway, RealtimeEvents } from '../../realtime/realtime.gateway';

@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(RestaurantTable)
    private tablesRepository: Repository<RestaurantTable>,
    private realtime: RealtimeGateway,
  ) {}

  findAll(storeId: string, includeInactive = false) {
    return this.tablesRepository.find({
      where: includeInactive ? { storeId } : { storeId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, storeId: string) {
    const table = await this.tablesRepository.findOne({ where: { id, storeId } });
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  async create(storeId: string, dto: CreateTableDto) {
    const name = dto.name.trim();

    // UNIQUE(storeId, name) also enforces this, but a clear message beats a
    // raw 23505 surfacing as a 500.
    const existing = await this.tablesRepository.findOne({ where: { storeId, name } });
    if (existing) {
      throw new ConflictException(`A table named "${name}" already exists`);
    }

    const table = await this.tablesRepository.save(
      this.tablesRepository.create({ storeId, name, status: 'free', isActive: true }),
    );

    this.realtime.emitToStore(storeId, RealtimeEvents.tableUpdated, table);
    return table;
  }

  async update(id: string, storeId: string, dto: UpdateTableDto) {
    const table = await this.findOne(id, storeId);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const clash = await this.tablesRepository.findOne({ where: { storeId, name } });
      if (clash && clash.id !== id) {
        throw new ConflictException(`A table named "${name}" already exists`);
      }
      table.name = name;
    }

    if (dto.isActive !== undefined) table.isActive = dto.isActive;

    const saved = await this.tablesRepository.save(table);
    this.realtime.emitToStore(storeId, RealtimeEvents.tableUpdated, saved);
    return saved;
  }

  /**
   * Soft-delete. `orders.tableId` references this row, so a hard delete would
   * either fail on the FK or erase which table a served order belonged to.
   */
  async deactivate(id: string, storeId: string) {
    const table = await this.findOne(id, storeId);

    if (table.status === 'reserved') {
      throw new ConflictException('Settle the open order before removing this table');
    }

    table.isActive = false;
    const saved = await this.tablesRepository.save(table);
    this.realtime.emitToStore(storeId, RealtimeEvents.tableUpdated, saved);
    return { message: 'Table removed' };
  }

  /**
   * Atomically claims a free table — the core concurrency guarantee.
   *
   * A single conditional UPDATE, not a read-then-write: Postgres serialises
   * concurrent UPDATEs on the same row and re-evaluates the WHERE after the
   * lock clears, so of two waiters punching the same table at the same moment
   * exactly one sees affected === 1. `SELECT` → check → `save()` would let both
   * through. No explicit lock needed.
   *
   * Runs inside the caller's transaction manager so it commits with the order.
   */
  async tryReserve(manager: EntityManager, tableId: string, storeId: string, orderId: string) {
    const result = await manager
      .createQueryBuilder()
      .update(RestaurantTable)
      .set({ status: 'reserved', currentOrderId: orderId })
      .where('id = :tableId', { tableId })
      .andWhere('"storeId" = :storeId', { storeId })
      .andWhere('status = :free', { free: 'free' })
      .andWhere('"isActive" = true')
      .execute();

    return result.affected === 1;
  }

  /** Releases a table once its order is settled or cancelled. */
  async release(manager: EntityManager, tableId: string, storeId: string) {
    await manager
      .createQueryBuilder()
      .update(RestaurantTable)
      .set({ status: 'free', currentOrderId: null })
      .where('id = :tableId', { tableId })
      .andWhere('"storeId" = :storeId', { storeId })
      .execute();
  }
}
