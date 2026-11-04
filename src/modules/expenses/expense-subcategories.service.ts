import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Expense, ExpenseCategory, ExpenseSubcategory } from '@/entities';
import { CreateExpenseSubcategoryDto, UpdateExpenseSubcategoryDto } from './dto';

/** What an expense write may say about its subcategory. */
export interface SubcategoryChoice {
  subcategoryId?: string | null;
  subcategoryName?: string;
}

@Injectable()
export class ExpenseSubcategoriesService {
  constructor(
    @InjectRepository(ExpenseSubcategory)
    private subcategoriesRepository: Repository<ExpenseSubcategory>,
    @InjectRepository(Expense)
    private expensesRepository: Repository<Expense>,
  ) {}

  /** The same-named subcategory under this category, case-insensitively. */
  private sameName(
    manager: EntityManager,
    storeId: string,
    categoryId: string,
    name: string,
    exceptId?: string,
  ): Promise<ExpenseSubcategory | null> {
    const qb = manager
      .createQueryBuilder(ExpenseSubcategory, 'sub')
      .where('sub.storeId = :storeId', { storeId })
      .andWhere('sub.categoryId = :categoryId', { categoryId })
      .andWhere('LOWER(sub.name) = LOWER(:name)', { name });
    if (exceptId) qb.andWhere('sub.id != :exceptId', { exceptId });
    return qb.getOne();
  }

  private async requireCategory(manager: EntityManager, storeId: string, categoryId: string) {
    const category = await manager.findOne(ExpenseCategory, {
      where: { id: categoryId, storeId },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Expense category not found for this store');
  }

  /**
   * Finds the subcategory by name under the category, or files a new one.
   *
   * A retired one with the same name comes back to life rather than sitting
   * beside a duplicate: "Ahmad" retired last month and typed again today is
   * the same person.
   */
  async findOrCreate(
    manager: EntityManager,
    storeId: string,
    categoryId: string,
    rawName: string,
  ): Promise<ExpenseSubcategory> {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('A subcategory needs a name');
    await this.requireCategory(manager, storeId, categoryId);

    const existing = await this.sameName(manager, storeId, categoryId, name);
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        return manager.save(ExpenseSubcategory, existing);
      }
      return existing;
    }
    return manager.save(ExpenseSubcategory, manager.create(ExpenseSubcategory, { storeId, categoryId, name }));
  }

  /**
   * The subcategory id an expense should carry, or `undefined` when the write
   * said nothing about it.
   *
   * A name wins over an id (the form sends whichever the user ended up with);
   * either must sit under `categoryId`, so an expense can never read
   * "Rent › Ahmad" because the category changed underneath its subcategory.
   */
  async resolve(
    manager: EntityManager,
    storeId: string,
    categoryId: string | null | undefined,
    choice: SubcategoryChoice,
  ): Promise<string | null | undefined> {
    const name = choice.subcategoryName?.trim();
    if (name) {
      if (!categoryId) throw new BadRequestException('Pick a category before a subcategory');
      return (await this.findOrCreate(manager, storeId, categoryId, name)).id;
    }
    if (choice.subcategoryId === undefined) return undefined;
    if (choice.subcategoryId === null) return null;

    const sub = await manager.findOne(ExpenseSubcategory, {
      where: { id: choice.subcategoryId, storeId },
      select: { id: true, categoryId: true },
    });
    if (!sub) throw new BadRequestException('Expense subcategory not found for this store');
    if (sub.categoryId !== categoryId) {
      throw new BadRequestException('That subcategory belongs to a different category');
    }
    return sub.id;
  }

  async create(storeId: string, dto: CreateExpenseSubcategoryDto): Promise<ExpenseSubcategory> {
    return this.findOrCreate(this.subcategoriesRepository.manager, storeId, dto.categoryId, dto.name);
  }

  async findOne(id: string, storeId: string): Promise<ExpenseSubcategory> {
    const sub = await this.subcategoriesRepository.findOne({ where: { id, storeId } });
    if (!sub) throw new NotFoundException('Expense subcategory not found');
    return sub;
  }

  async update(id: string, storeId: string, dto: UpdateExpenseSubcategoryDto): Promise<ExpenseSubcategory> {
    const sub = await this.findOne(id, storeId);
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('A subcategory needs a name');
      const clash = await this.sameName(this.subcategoriesRepository.manager, storeId, sub.categoryId, name, id);
      if (clash) throw new ConflictException(`"${name}" already exists under this category`);
      dto = { ...dto, name };
    }
    return this.subcategoriesRepository.save(this.subcategoriesRepository.merge(sub, dto));
  }

  /** Deletes it; the expenses booked to it keep their category and lose only this level. */
  async remove(id: string, storeId: string): Promise<{ message: string }> {
    const sub = await this.findOne(id, storeId);
    await this.expensesRepository.update({ subcategoryId: id, storeId }, { subcategoryId: null });
    await this.subcategoriesRepository.remove(sub);
    return { message: 'Expense subcategory deleted' };
  }

  /** Detaches and deletes every subcategory of a category that is itself being deleted. */
  async removeAllOf(categoryId: string, storeId: string): Promise<void> {
    const subs = await this.subcategoriesRepository.find({ where: { categoryId, storeId }, select: { id: true } });
    if (!subs.length) return;
    for (const sub of subs) {
      await this.expensesRepository.update({ subcategoryId: sub.id, storeId }, { subcategoryId: null });
    }
    await this.subcategoriesRepository.delete({ categoryId, storeId });
  }
}
