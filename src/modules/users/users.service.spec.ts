import { UsersService } from './users.service';
import { AuthService } from '../../auth/auth.service';

/** A query builder whose every chain call returns itself. */
function queryBuilder(result: Record<string, unknown>) {
  const qb: any = {};
  for (const method of ['innerJoin', 'where', 'andWhere', 'select']) {
    qb[method] = jest.fn(() => qb);
  }
  return Object.assign(qb, result);
}

describe('UsersService.update — deactivating a store', () => {
  function setup(staffUserIds: (string | null)[]) {
    const users = {
      update: jest.fn(),
      findOne: jest.fn(async () => ({ id: 'owner', passwordHash: 'x' })),
    };
    const employees = {
      createQueryBuilder: jest.fn(() =>
        queryBuilder({ getRawMany: jest.fn(async () => staffUserIds.map((userId) => ({ userId }))) }),
      ),
    };
    const refreshTokens = { revokeAllForUsers: jest.fn() };
    const realtime = { signOutUsers: jest.fn() };
    const service = new UsersService(
      users as any,
      employees as any,
      refreshTokens as any,
      realtime as any,
    );
    return { service, refreshTokens, realtime };
  }

  it('signs out the owner and every member of their staff', async () => {
    const { service, refreshTokens, realtime } = setup(['waiter', 'kitchen', null]);

    await service.update('owner', { isActive: false } as any);

    const everyone = ['owner', 'waiter', 'kitchen'];
    expect(refreshTokens.revokeAllForUsers).toHaveBeenCalledWith(everyone);
    expect(realtime.signOutUsers).toHaveBeenCalledWith(everyone);
  });

  it('leaves sessions alone when the store is reactivated or edited', async () => {
    const { service, refreshTokens, realtime } = setup(['waiter']);

    await service.update('owner', { isActive: true } as any);
    await service.update('owner', { name: 'Renamed' } as any);

    expect(refreshTokens.revokeAllForUsers).not.toHaveBeenCalled();
    expect(realtime.signOutUsers).not.toHaveBeenCalled();
  });
});

describe('AuthService.inactiveReason', () => {
  function setup(storeInactive: boolean) {
    const employees = {
      createQueryBuilder: jest.fn(() =>
        queryBuilder({ getExists: jest.fn(async () => storeInactive) }),
      ),
    };
    const service = new AuthService({} as any, {} as any, employees as any, {} as any, {} as any);
    return { service, employees };
  }

  it('refuses a deactivated account', async () => {
    const { service } = setup(false);
    await expect(
      service.inactiveReason({ id: 'u', role: 'store_owner', isActive: false }),
    ).resolves.toBe('Your account is inactive.');
  });

  it('refuses staff whose store has been deactivated', async () => {
    const { service } = setup(true);
    await expect(
      service.inactiveReason({ id: 'u', role: 'employee', isActive: true }),
    ).resolves.toBe('This store has been deactivated.');
  });

  it('lets active staff of an active store through', async () => {
    const { service } = setup(false);
    await expect(
      service.inactiveReason({ id: 'u', role: 'employee', isActive: true }),
    ).resolves.toBeNull();
  });

  it('skips the store lookup for an active owner', async () => {
    const { service, employees } = setup(true);
    await expect(
      service.inactiveReason({ id: 'u', role: 'store_owner', isActive: true }),
    ).resolves.toBeNull();
    expect(employees.createQueryBuilder).not.toHaveBeenCalled();
  });
});
