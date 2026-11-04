import { BadRequestException } from '@nestjs/common';
import { ExpenseSubcategoriesService } from './expense-subcategories.service';

/**
 * How an expense write picks its subcategory: by name (found or filed under
 * the category) or by id (which must sit under the same category).
 */
function setup(options: { existingByName?: any; byId?: any; category?: boolean } = {}) {
  const saved: any[] = [];
  const qb: any = {};
  for (const method of ['where', 'andWhere']) qb[method] = jest.fn(() => qb);
  qb.getOne = jest.fn(async () => options.existingByName ?? null);

  const manager = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(async (entity: any) =>
      entity?.name === 'ExpenseCategory'
        ? options.category === false
          ? null
          : { id: 'cat-petrol' }
        : (options.byId ?? null),
    ),
    create: jest.fn((_entity: unknown, row: any) => ({ ...row })),
    save: jest.fn(async (_entity: unknown, row: any) => {
      const withId = { id: row.id ?? 'sub-new', ...row };
      saved.push(withId);
      return withId;
    }),
  };

  const service = new ExpenseSubcategoriesService({ manager } as any, {} as any);
  return { service, manager, saved };
}

describe('ExpenseSubcategoriesService.resolve', () => {
  it('files a new subcategory under the category when a new name is typed', async () => {
    const { service, manager, saved } = setup();
    const id = await service.resolve(manager as any, 'store-1', 'cat-petrol', { subcategoryName: '  Ahmad ' });
    expect(id).toBe('sub-new');
    expect(saved[0]).toMatchObject({ storeId: 'store-1', categoryId: 'cat-petrol', name: 'Ahmad' });
  });

  it('reuses the one already there, whatever the case', async () => {
    const { service, manager, saved } = setup({ existingByName: { id: 'sub-ahmad', name: 'Ahmad', isActive: true } });
    expect(await service.resolve(manager as any, 'store-1', 'cat-petrol', { subcategoryName: 'ahmad' })).toBe('sub-ahmad');
    expect(saved).toHaveLength(0);
  });

  it('brings a retired one back rather than filing a duplicate', async () => {
    const retired = { id: 'sub-ahmad', name: 'Ahmad', isActive: false };
    const { service, manager, saved } = setup({ existingByName: retired });
    expect(await service.resolve(manager as any, 'store-1', 'cat-petrol', { subcategoryName: 'Ahmad' })).toBe('sub-ahmad');
    expect(saved[0]).toMatchObject({ id: 'sub-ahmad', isActive: true });
  });

  it('needs a category before a subcategory name means anything', async () => {
    const { service, manager } = setup();
    await expect(service.resolve(manager as any, 'store-1', null, { subcategoryName: 'Ahmad' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("refuses another store's category", async () => {
    const { service, manager } = setup({ category: false });
    await expect(
      service.resolve(manager as any, 'store-1', 'cat-elsewhere', { subcategoryName: 'Ahmad' }),
    ).rejects.toThrow('Expense category not found for this store');
  });

  it('accepts an id only when it sits under the chosen category', async () => {
    const { service, manager } = setup({ byId: { id: 'sub-ahmad', categoryId: 'cat-petrol' } });
    expect(await service.resolve(manager as any, 'store-1', 'cat-petrol', { subcategoryId: 'sub-ahmad' })).toBe('sub-ahmad');
    await expect(
      service.resolve(manager as any, 'store-1', 'cat-rent', { subcategoryId: 'sub-ahmad' }),
    ).rejects.toThrow('That subcategory belongs to a different category');
  });

  it("refuses an id from another store", async () => {
    const { service, manager } = setup({ byId: null });
    await expect(
      service.resolve(manager as any, 'store-1', 'cat-petrol', { subcategoryId: 'sub-elsewhere' }),
    ).rejects.toThrow('Expense subcategory not found for this store');
  });

  it('reports "unchanged" when the write says nothing, and clears on null', async () => {
    const { service, manager } = setup();
    expect(await service.resolve(manager as any, 'store-1', 'cat-petrol', {})).toBeUndefined();
    expect(await service.resolve(manager as any, 'store-1', 'cat-petrol', { subcategoryId: null })).toBeNull();
  });
});
