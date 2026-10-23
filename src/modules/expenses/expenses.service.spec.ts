import { ConflictException } from '@nestjs/common';
import { ExpensesService, OPEN_SHIFT_FOR_EXPENSES } from './expenses.service';

/**
 * The shift rule on the ledger: a cashier or supervisor on a tenant with
 * shifts on cannot touch an expense without an open drawer. Everyone else is
 * linked to a drawer when one happens to be open, and never blocked.
 */
function setup(options: { enforced?: boolean; openShiftId?: string | null } = {}) {
  const enforced = options.enforced ?? true;
  const openShiftId = options.openShiftId === undefined ? null : options.openShiftId;

  const saved: any[] = [];
  const manager = {
    create: jest.fn((_entity: unknown, row: any) => ({ ...row })),
    save: jest.fn(async (_entity: unknown, row: any) => {
      const withId = { id: 'exp-1', ...row };
      saved.push(withId);
      return withId;
    }),
  };
  const dataSource = {
    manager,
    transaction: jest.fn(async (work: (m: any) => Promise<unknown>) => work(manager)),
  };
  const shiftsService = {
    isEnforced: jest.fn(async () => enforced),
    stampSettlement: jest.fn(async (_m: unknown, _s: string, userId: string, opts: { enforce: boolean }) => {
      if (!openShiftId && opts.enforce) throw new ConflictException('Open your shift before taking payments.');
      return { shiftId: openShiftId, settledById: userId, settledAt: new Date() };
    }),
  };
  const existing = { id: 'exp-1', storeId: 'store-1', title: 'Gas', amount: 500 };
  const expensesRepository = {
    findOne: jest.fn(async () => existing),
    merge: jest.fn((target: any, patch: any) => Object.assign(target, patch)),
    save: jest.fn(async (row: any) => row),
    remove: jest.fn(async (): Promise<void> => undefined),
  };
  const categoriesRepository = { findOne: jest.fn(async () => ({ id: 'cat-1' })) };

  const service = new ExpensesService(
    expensesRepository as any,
    categoriesRepository as any,
    shiftsService as any,
    dataSource as any,
  );
  // findOne joins the category; stub it so create/update return the saved row.
  (service as any).findOne = jest.fn(async (id: string) => saved.find((r) => r.id === id) ?? existing);

  return { service, manager, shiftsService, expensesRepository, saved };
}

const dto = { title: ' Gas ', amount: 500, paymentMethod: 'cash', expenseDate: '2026-10-21' } as any;
const cashier = { id: 'u-cashier', effectiveRole: 'cashier' };
const supervisor = { id: 'u-sup', effectiveRole: 'supervisor' };
const owner = { id: 'u-owner', effectiveRole: 'restaurant_owner' };
const waiter = { id: 'u-waiter', effectiveRole: 'waiter' };

describe('ExpensesService.create — the shift rule', () => {
  it('refuses a cashier with no open drawer, whatever the payment method', async () => {
    const { service, manager } = setup({ openShiftId: null });

    await expect(service.create('store-1', dto, cashier)).rejects.toThrow(OPEN_SHIFT_FOR_EXPENSES);
    await expect(service.create('store-1', { ...dto, paymentMethod: 'card' }, cashier)).rejects.toThrow(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses a supervisor the same way', async () => {
    const { service } = setup({ openShiftId: null });
    await expect(service.create('store-1', dto, supervisor)).rejects.toThrow(OPEN_SHIFT_FOR_EXPENSES);
  });

  it('books a cash expense against the open drawer, inside the transaction', async () => {
    const { service, shiftsService, saved } = setup({ openShiftId: 'shift-9' });

    await service.create('store-1', dto, cashier);

    expect(shiftsService.stampSettlement).toHaveBeenCalledWith(
      expect.anything(),
      'store-1',
      'u-cashier',
      { enforce: true },
    );
    expect(saved[0]).toMatchObject({ shiftId: 'shift-9', createdById: 'u-cashier', title: 'Gas', storeId: 'store-1' });
  });

  it('requires the drawer for card spend too, but does not link it to the drawer', async () => {
    const { service, saved } = setup({ openShiftId: 'shift-9' });

    await service.create('store-1', { ...dto, paymentMethod: 'card' }, cashier);

    expect(saved[0]).toMatchObject({ shiftId: null, paymentMethod: 'card' });
  });

  it('never blocks an owner, and still links their cash spend when a drawer is open', async () => {
    const noDrawer = setup({ openShiftId: null });
    await expect(noDrawer.service.create('store-1', dto, owner)).resolves.toBeDefined();
    expect(noDrawer.saved[0]).toMatchObject({ shiftId: null });

    const withDrawer = setup({ openShiftId: 'shift-2' });
    await withDrawer.service.create('store-1', dto, owner);
    expect(withDrawer.shiftsService.stampSettlement).toHaveBeenCalledWith(
      expect.anything(),
      'store-1',
      'u-owner',
      { enforce: false },
    );
    expect(withDrawer.saved[0]).toMatchObject({ shiftId: 'shift-2' });
  });

  it('never blocks a waiter granted the ledger — they cannot open a shift', async () => {
    const { service } = setup({ openShiftId: null });
    await expect(service.create('store-1', dto, waiter)).resolves.toBeDefined();
  });

  it('does not gate a tenant that has shifts turned off', async () => {
    const { service, shiftsService } = setup({ enforced: false, openShiftId: null });

    await expect(service.create('store-1', dto, cashier)).resolves.toBeDefined();

    // Still soft-linked like before: stamp was asked for, not enforced.
    expect(shiftsService.stampSettlement).toHaveBeenCalledWith(
      expect.anything(),
      'store-1',
      'u-cashier',
      { enforce: false },
    );
  });

  it('tolerates API callers with no actor at all', async () => {
    const { service, saved } = setup({ openShiftId: null });
    await expect(service.create('store-1', dto)).resolves.toBeDefined();
    expect(saved[0]).toMatchObject({ createdById: null, shiftId: null });
  });
});

describe('ExpensesService.update / remove — the shift rule', () => {
  it('refuses a shift-less cashier and leaves the row alone', async () => {
    const { service, expensesRepository } = setup({ openShiftId: null });

    await expect(service.update('exp-1', 'store-1', { amount: 1 } as any, cashier)).rejects.toThrow(
      OPEN_SHIFT_FOR_EXPENSES,
    );
    await expect(service.remove('exp-1', 'store-1', cashier)).rejects.toThrow(OPEN_SHIFT_FOR_EXPENSES);
    expect(expensesRepository.save).not.toHaveBeenCalled();
    expect(expensesRepository.remove).not.toHaveBeenCalled();
  });

  it('lets a cashier with an open drawer, and an owner without one, edit and delete', async () => {
    const withDrawer = setup({ openShiftId: 'shift-9' });
    await expect(withDrawer.service.update('exp-1', 'store-1', { amount: 1 } as any, cashier)).resolves.toBeDefined();
    await expect(withDrawer.service.remove('exp-1', 'store-1', cashier)).resolves.toEqual({ message: 'Expense deleted' });

    const noDrawer = setup({ openShiftId: null });
    await expect(noDrawer.service.remove('exp-1', 'store-1', owner)).resolves.toEqual({ message: 'Expense deleted' });
  });
});
