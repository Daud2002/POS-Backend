import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  InventoryItem,
  InventoryMovement,
  InventoryUnit,
  OrderItem,
  Product,
  ProductIngredient,
} from '@/entities';
import { toPage, type Page } from '@/common';
import { RealtimeGateway, RealtimeEvents } from '../../realtime/realtime.gateway';
import {
  AdjustStockDto,
  CreateInventoryItemDto,
  SetRecipeDto,
  StockInDto,
  UpdateInventoryItemDto,
} from './dto';

/** Stock is kept to three decimals, the same as the column. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * How much of each ingredient a set of sold lines uses.
 *
 * Pure, so the arithmetic is testable without a database: lines are summed
 * per product first (the same dish ordered in two rounds is two lines), then
 * each recipe line is multiplied out and summed per ingredient — two dishes
 * sharing milk draw on one milk total. Products without a recipe consume
 * nothing.
 */
export function ingredientUsage(
  lines: Pick<OrderItem, 'productId' | 'quantity'>[],
  recipes: Pick<ProductIngredient, 'productId' | 'inventoryItemId' | 'quantity'>[],
): Map<string, number> {
  const sold = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    sold.set(line.productId, (sold.get(line.productId) ?? 0) + Number(line.quantity));
  }

  const usage = new Map<string, number>();
  for (const recipe of recipes) {
    const count = sold.get(recipe.productId);
    if (!count) continue;
    const used = Number(recipe.quantity) * count;
    usage.set(recipe.inventoryItemId, round3((usage.get(recipe.inventoryItemId) ?? 0) + used));
  }
  return usage;
}

/** What a stock-in adds, in the item's own unit. Sets only mean anything for bottles. */
export function stockInQuantity(
  item: Pick<InventoryItem, 'unit' | 'packSize'>,
  dto: Pick<StockInDto, 'amount' | 'inPacks'>,
): number {
  const packs = dto.inPacks && item.unit === 'bottle';
  return round3(packs ? dto.amount * (item.packSize || 1) : dto.amount);
}

export interface InventoryFilters {
  search?: string;
  includeInactive?: boolean;
}

/**
 * A restaurant's ingredient stock, and the recipes that consume it.
 *
 * Counts move ONLY through the methods here, and every move writes an
 * InventoryMovement — the count is never edited in place without a trail.
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem)
    private itemsRepository: Repository<InventoryItem>,
    @InjectRepository(InventoryMovement)
    private movementsRepository: Repository<InventoryMovement>,
    @InjectRepository(ProductIngredient)
    private ingredientsRepository: Repository<ProductIngredient>,
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    private realtime: RealtimeGateway,
  ) {}

  // ------------------------------------------------------------- items

  /** Case-insensitive, so "Milk" and "milk" cannot both appear in a recipe picker. */
  private async assertNameFree(storeId: string, name: string, exceptId?: string) {
    const qb = this.itemsRepository
      .createQueryBuilder('item')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('LOWER(item.name) = LOWER(:name)', { name: name.trim() });
    if (exceptId) qb.andWhere('item.id != :exceptId', { exceptId });
    if (await qb.getExists()) {
      throw new ConflictException(`An inventory item named "${name.trim()}" already exists`);
    }
  }

  private listQuery(storeId: string, filters: InventoryFilters) {
    const qb = this.itemsRepository
      .createQueryBuilder('item')
      .where('item.storeId = :storeId', { storeId })
      .orderBy('LOWER(item.name)', 'ASC');
    if (!filters.includeInactive) qb.andWhere('item.isActive = true');
    const search = filters.search?.trim();
    if (search) qb.andWhere('item.name ILIKE :search', { search: `%${search}%` });
    return qb;
  }

  /** Unpaged: feeds the recipe picker, which must offer every ingredient. */
  findAll(storeId: string, filters: InventoryFilters = {}): Promise<InventoryItem[]> {
    return this.listQuery(storeId, filters).getMany();
  }

  async findAllPaged(
    storeId: string,
    skip: number,
    take: number,
    filters: InventoryFilters = {},
  ): Promise<Page<InventoryItem>> {
    const [items, total] = await this.listQuery(storeId, filters)
      .skip(skip)
      .take(take)
      .getManyAndCount();
    return toPage(items, total, skip, take);
  }

  async findOne(id: string, storeId: string): Promise<InventoryItem> {
    const item = await this.itemsRepository.findOne({ where: { id, storeId } });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  async create(storeId: string, dto: CreateInventoryItemDto, userId: string) {
    await this.assertNameFree(storeId, dto.name);
    const opening = round3(dto.quantity ?? 0);

    const saved = await this.itemsRepository.manager.transaction(async (manager) => {
      const item = await manager.save(
        manager.create(InventoryItem, {
          storeId,
          name: dto.name.trim(),
          unit: dto.unit as InventoryUnit,
          packSize: dto.packSize ?? 6,
          quantity: opening,
          lowStockThreshold: dto.lowStockThreshold ?? null,
        }),
      );
      if (opening !== 0) {
        await manager.insert(InventoryMovement, {
          storeId,
          inventoryItemId: item.id,
          type: 'stock_in',
          quantity: opening,
          note: 'Opening stock',
          createdById: userId,
        });
      }
      return item;
    });
    this.emit(storeId, [saved.id]);
    return saved;
  }

  async update(id: string, storeId: string, dto: UpdateInventoryItemDto) {
    const item = await this.findOne(id, storeId);
    if (dto.name !== undefined) {
      await this.assertNameFree(storeId, dto.name, id);
      item.name = dto.name.trim();
    }
    if (dto.packSize !== undefined) item.packSize = dto.packSize;
    if (dto.lowStockThreshold !== undefined) item.lowStockThreshold = dto.lowStockThreshold;
    if (dto.isActive !== undefined) item.isActive = dto.isActive;
    const saved = await this.itemsRepository.save(item);
    this.emit(storeId, [id]);
    return saved;
  }

  /**
   * Hard delete, for an item added by mistake. One still named by a recipe is
   * refused — retiring it keeps the recipe and its history readable.
   */
  async remove(id: string, storeId: string) {
    await this.findOne(id, storeId);
    const usedBy = await this.ingredientsRepository.count({ where: { inventoryItemId: id } });
    if (usedBy > 0) {
      throw new ConflictException(
        `This item is used in ${usedBy} recipe${usedBy === 1 ? '' : 's'}. Retire it instead, or remove it from those recipes first.`,
      );
    }
    await this.itemsRepository.delete({ id, storeId });
    this.emit(storeId, [id]);
    return { id, deleted: true };
  }

  // ------------------------------------------------------------ counts

  async stockIn(id: string, storeId: string, dto: StockInDto, userId: string) {
    const item = await this.findOne(id, storeId);
    const added = stockInQuantity(item, dto);
    const note = dto.note?.trim()
      || (dto.inPacks && item.unit === 'bottle' ? `${dto.amount} set(s) of ${item.packSize}` : null);

    await this.itemsRepository.manager.transaction(async (manager) => {
      // Atomic increment: a sale settling at the same moment must not be lost
      // to a read-modify-write.
      await manager.increment(InventoryItem, { id, storeId }, 'quantity', added);
      await manager.insert(InventoryMovement, {
        storeId,
        inventoryItemId: id,
        type: 'stock_in',
        quantity: added,
        note,
        createdById: userId,
      });
    });
    this.emit(storeId, [id]);
    return this.findOne(id, storeId);
  }

  /** Sets the count to what was physically counted, recording the difference. */
  async adjust(id: string, storeId: string, dto: AdjustStockDto, userId: string) {
    await this.findOne(id, storeId);
    const target = round3(dto.quantity);

    await this.itemsRepository.manager.transaction(async (manager) => {
      // Locked, so the difference is taken against the count as it really is
      // and not one a concurrent sale is about to change.
      const current = await manager.findOne(InventoryItem, {
        where: { id, storeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw new NotFoundException('Inventory item not found');
      const diff = round3(target - Number(current.quantity));
      if (diff === 0) return;

      await manager.update(InventoryItem, { id, storeId }, { quantity: target });
      await manager.insert(InventoryMovement, {
        storeId,
        inventoryItemId: id,
        type: 'adjustment',
        quantity: diff,
        note: dto.note?.trim() || null,
        createdById: userId,
      });
    });
    this.emit(storeId, [id]);
    return this.findOne(id, storeId);
  }

  async movements(
    id: string,
    storeId: string,
    skip: number,
    take: number,
  ): Promise<Page<InventoryMovement>> {
    await this.findOne(id, storeId);
    const [items, total] = await this.movementsRepository.findAndCount({
      where: { inventoryItemId: id, storeId },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
    return toPage(items, total, skip, take);
  }

  // ----------------------------------------------------------- recipes

  private async assertProduct(productId: string, storeId: string) {
    const exists = await this.productsRepository.exists({ where: { id: productId, storeId } });
    if (!exists) throw new NotFoundException('Product not found');
  }

  async getRecipe(productId: string, storeId: string) {
    await this.assertProduct(productId, storeId);
    const lines = await this.ingredientsRepository.find({
      where: { productId },
      relations: ['inventoryItem'],
    });
    return lines
      .map((line) => ({
        inventoryItemId: line.inventoryItemId,
        quantity: Number(line.quantity),
        name: line.inventoryItem?.name ?? '',
        unit: line.inventoryItem?.unit ?? 'g',
        isActive: line.inventoryItem?.isActive ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Replaces the whole recipe — the form always sends every line. */
  async setRecipe(productId: string, storeId: string, dto: SetRecipeDto) {
    await this.assertProduct(productId, storeId);

    const ids = dto.ingredients.map((l) => l.inventoryItemId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('An ingredient appears twice in this recipe');
    }
    if (ids.length) {
      // Scoped to the store, or a recipe could draw down another tenant's stock.
      const found = await this.itemsRepository.count({ where: { id: In(ids), storeId } });
      if (found !== ids.length) {
        throw new BadRequestException('One or more ingredients are not in this store');
      }
    }

    await this.ingredientsRepository.manager.transaction(async (manager) => {
      await manager.delete(ProductIngredient, { productId });
      if (dto.ingredients.length) {
        await manager.insert(
          ProductIngredient,
          dto.ingredients.map((l) => ({
            productId,
            inventoryItemId: l.inventoryItemId,
            quantity: round3(l.quantity),
          })),
        );
      }
    });
    return this.getRecipe(productId, storeId);
  }

  // ------------------------------------------------------------- sales

  /**
   * Draws a settled order's ingredients out of stock.
   *
   * Runs on the CALLER's transaction manager, so the deduction commits or
   * rolls back together with the payment — an order is never paid without
   * its stock moving, nor stock moved for a payment that failed.
   *
   * Never refuses: a count may go negative. Blocking the till because the
   * stock sheet is out of date would punish the customer for a bookkeeping
   * slip; a negative count flags it for correction instead.
   *
   * Returns the ids of the items it touched, for the caller to announce once
   * the transaction has committed.
   */
  async consumeForOrder(
    manager: EntityManager,
    storeId: string,
    orderId: string,
    lines: Pick<OrderItem, 'productId' | 'quantity'>[],
    userId: string | null,
  ): Promise<string[]> {
    const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
    if (!productIds.length) return [];

    const recipes = await manager
      .createQueryBuilder(ProductIngredient, 'pi')
      .innerJoin('pi.inventoryItem', 'item')
      .where('pi.productId IN (:...productIds)', { productIds })
      .andWhere('item.storeId = :storeId', { storeId })
      .getMany();

    const usage = ingredientUsage(lines, recipes);
    if (!usage.size) return [];

    // A fixed order, so two tills settling at once lock rows the same way
    // round and cannot deadlock each other.
    const itemIds = [...usage.keys()].sort();
    for (const itemId of itemIds) {
      await manager.decrement(InventoryItem, { id: itemId, storeId }, 'quantity', usage.get(itemId)!);
    }
    await manager.insert(
      InventoryMovement,
      itemIds.map((itemId) => ({
        storeId,
        inventoryItemId: itemId,
        type: 'sale' as const,
        quantity: -usage.get(itemId)!,
        orderId,
        createdById: userId,
      })),
    );
    return itemIds;
  }

  /** Tells open inventory screens to refetch. */
  emit(storeId: string, itemIds: string[]) {
    if (!itemIds.length) return;
    this.realtime.emitToStore(storeId, RealtimeEvents.inventoryUpdated, { itemIds });
  }
}
