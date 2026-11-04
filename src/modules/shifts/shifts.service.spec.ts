import { ConflictException } from '@nestjs/common';
import { OPEN_SHIFT_FIRST, ShiftsService } from './shifts.service';

/**
 * The till rule for everything that changes what a drawer will collect:
 * cashiers and supervisors need a shift open, on a tenant with shifts on.
 */
function setup(options: { shiftsEnabled?: boolean; accountType?: string; openShift?: boolean } = {}) {
  const store = {
    id: 'store-1',
    shiftsEnabled: options.shiftsEnabled ?? true,
    accountType: options.accountType ?? 'restaurant',
  };
  const storesRepository = { findOne: jest.fn(async () => store) };

  const qb: any = {};
  for (const method of ['where', 'andWhere', 'setLock']) qb[method] = jest.fn(() => qb);
  qb.getOne = jest.fn(async () => (options.openShift ? { id: 'shift-1', status: 'open' } : null));
  const dataSource = { manager: { createQueryBuilder: jest.fn(() => qb) } };

  const service = new ShiftsService({} as any, storesRepository as any, {} as any, dataSource as any);
  return { service, storesRepository, qb };
}

describe('ShiftsService.assertOpenShiftIfGated', () => {
  it('refuses a cashier or supervisor with no open shift', async () => {
    const { service } = setup({ openShift: false });
    await expect(service.assertOpenShiftIfGated('store-1', { userId: 'c', role: 'cashier' })).rejects.toThrow(
      new ConflictException(OPEN_SHIFT_FIRST),
    );
    await expect(service.assertOpenShiftIfGated('store-1', { userId: 's', role: 'supervisor' })).rejects.toThrow(
      OPEN_SHIFT_FIRST,
    );
  });

  it('lets them through once their shift is open', async () => {
    const { service, qb } = setup({ openShift: true });
    await expect(service.assertOpenShiftIfGated('store-1', { userId: 'c', role: 'cashier' })).resolves.toBeUndefined();
    expect(qb.where).toHaveBeenCalledWith('shift.userId = :userId', { userId: 'c' });
  });

  it('never gates waiters, kitchen or owners', async () => {
    const { service, storesRepository } = setup({ openShift: false });
    for (const role of ['waiter', 'kitchen', 'restaurant_owner', null]) {
      await expect(service.assertOpenShiftIfGated('store-1', { userId: 'x', role })).resolves.toBeUndefined();
    }
    // Decided from the role alone: no store lookup for them.
    expect(storesRepository.findOne).not.toHaveBeenCalled();
  });

  it('does nothing where shifts are off, or on a general store', async () => {
    for (const options of [{ shiftsEnabled: false }, { accountType: 'general' }]) {
      const { service } = setup({ ...options, openShift: false });
      await expect(service.assertOpenShiftIfGated('store-1', { userId: 'c', role: 'cashier' })).resolves.toBeUndefined();
    }
  });
});
