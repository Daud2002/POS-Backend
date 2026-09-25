import { InventoryService, ingredientUsage, stockInQuantity } from './inventory.service';
import { InventoryItem, InventoryMovement } from '@/entities';

describe('ingredientUsage', () => {
  const recipes = [
    { productId: 'latte', inventoryItemId: 'milk', quantity: 200 },
    { productId: 'latte', inventoryItemId: 'beans', quantity: 18 },
    { productId: 'cappuccino', inventoryItemId: 'milk', quantity: 150 },
    { productId: 'coke', inventoryItemId: 'coke-bottle', quantity: 1 },
  ];

  it('multiplies each recipe line by the quantity sold', () => {
    const usage = ingredientUsage([{ productId: 'latte', quantity: 3 }], recipes);
    expect(usage.get('milk')).toBe(600);
    expect(usage.get('beans')).toBe(54);
  });

  it('sums a shared ingredient across dishes and across rounds of the same dish', () => {
    const usage = ingredientUsage(
      [
        { productId: 'latte', quantity: 1 },
        { productId: 'cappuccino', quantity: 2 },
        // The same dish ordered again in a later round is a second line.
        { productId: 'latte', quantity: 1 },
      ],
      recipes,
    );
    expect(usage.get('milk')).toBe(200 * 2 + 150 * 2);
    expect(usage.get('beans')).toBe(36);
  });

  it('deducts one bottle per bottled drink sold', () => {
    const usage = ingredientUsage([{ productId: 'coke', quantity: 4 }], recipes);
    expect(usage.get('coke-bottle')).toBe(4);
  });

  it('ignores products that have no recipe', () => {
    const usage = ingredientUsage([{ productId: 'naan', quantity: 5 }], recipes);
    expect(usage.size).toBe(0);
  });

  it('does not accumulate floating-point dust', () => {
    const usage = ingredientUsage(
      [{ productId: 'tea', quantity: 3 }],
      [{ productId: 'tea', inventoryItemId: 'sugar', quantity: 0.1 }],
    );
    expect(usage.get('sugar')).toBe(0.3);
  });
});

describe('stockInQuantity', () => {
  const bottle = { unit: 'bottle' as const, packSize: 6 };

  it('turns sets of bottles into bottles', () => {
    expect(stockInQuantity(bottle, { amount: 4, inPacks: true })).toBe(24);
  });

  it('takes single bottles as given', () => {
    expect(stockInQuantity(bottle, { amount: 4, inPacks: false })).toBe(4);
  });

  it('ignores inPacks for ml and g items', () => {
    expect(stockInQuantity({ unit: 'ml', packSize: 6 }, { amount: 1000, inPacks: true })).toBe(1000);
  });
});

describe('InventoryService.consumeForOrder', () => {
  const realtime = { emitToStore: jest.fn() };
  const service = new InventoryService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    realtime as any,
  );

  function managerWith(recipes: any[]) {
    const qb: any = {
      innerJoin: () => qb,
      where: () => qb,
      andWhere: () => qb,
      getMany: jest.fn().mockResolvedValue(recipes),
    };
    return {
      createQueryBuilder: jest.fn(() => qb),
      decrement: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('decrements each ingredient and logs a sale movement against the order', async () => {
    const manager = managerWith([
      { productId: 'latte', inventoryItemId: 'milk', quantity: 200 },
      { productId: 'latte', inventoryItemId: 'beans', quantity: 18 },
    ]);

    const touched = await service.consumeForOrder(
      manager as any,
      'store-1',
      'order-1',
      [{ productId: 'latte', quantity: 2 }],
      'cashier-1',
    );

    expect(touched).toEqual(['beans', 'milk']);
    expect(manager.decrement).toHaveBeenCalledWith(
      InventoryItem, { id: 'milk', storeId: 'store-1' }, 'quantity', 400,
    );
    expect(manager.decrement).toHaveBeenCalledWith(
      InventoryItem, { id: 'beans', storeId: 'store-1' }, 'quantity', 36,
    );
    expect(manager.insert).toHaveBeenCalledWith(InventoryMovement, [
      expect.objectContaining({ inventoryItemId: 'beans', type: 'sale', quantity: -36, orderId: 'order-1' }),
      expect.objectContaining({ inventoryItemId: 'milk', type: 'sale', quantity: -400, orderId: 'order-1' }),
    ]);
  });

  it('touches nothing when no sold product has a recipe', async () => {
    const manager = managerWith([]);
    const touched = await service.consumeForOrder(
      manager as any, 'store-1', 'order-1', [{ productId: 'naan', quantity: 1 }], null,
    );
    expect(touched).toEqual([]);
    expect(manager.decrement).not.toHaveBeenCalled();
    expect(manager.insert).not.toHaveBeenCalled();
  });

  it('skips the query entirely for an order with no product lines', async () => {
    const manager = managerWith([]);
    await service.consumeForOrder(manager as any, 'store-1', 'order-1', [], null);
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });
});
