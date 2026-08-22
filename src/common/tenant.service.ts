import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, Employee } from '../entities';

/**
 * Resolves which store a request may touch.
 *
 * Replaces five verbatim copies of `getStoreIdFromUser` that had already
 * drifted apart — the products and categories copies silently lacked an
 * `admin` branch, so platform admins got a 400 there but full cross-tenant
 * access everywhere else.
 */
@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
  ) {}

  /**
   * The store this user is scoped to.
   *
   * Returns `undefined` for platform admins, which callers treat as
   * "no WHERE clause" i.e. cross-tenant read access. Preserved from the
   * original implementation so admin dashboards keep working.
   */
  async resolveStoreId(user: any): Promise<string | undefined> {
    if (!user) throw new ForbiddenException('Not authenticated');

    if (user.role === 'admin') return undefined;

    // Already grafted on by AuthService.getUserWithStore() for most requests.
    if (user.storeId) return user.storeId;

    if (user.role === 'store_owner') {
      const store = await this.storesRepository.findOne({ where: { userId: user.id } });
      if (!store) throw new BadRequestException('Store not found for this user');
      return store.id;
    }

    if (user.role === 'employee' || user.role === 'cashier') {
      const employee = await this.employeesRepository.findOne({ where: { userId: user.id } });
      if (!employee) throw new BadRequestException('Employee record not found');
      return employee.storeId;
    }

    throw new BadRequestException('Invalid user role for this operation');
  }

  /** Same as resolveStoreId, but rejects the cross-tenant admin case. */
  async requireStoreId(user: any): Promise<string> {
    const storeId = await this.resolveStoreId(user);
    if (!storeId) {
      throw new BadRequestException('This operation requires a specific store');
    }
    return storeId;
  }

  /**
   * Asserts the user may act on `storeId`, and returns it.
   *
   * Needed wherever a storeId arrives as a route param or query string rather
   * than being derived from the token — otherwise any authenticated user can
   * simply pass someone else's store id.
   */
  async assertStoreAccess(user: any, storeId: string): Promise<string> {
    const own = await this.resolveStoreId(user);
    if (own === undefined) return storeId; // platform admin: unscoped
    if (own !== storeId) {
      throw new ForbiddenException('You do not have access to this store');
    }
    return storeId;
  }

  async getStore(storeId: string): Promise<Store> {
    const store = await this.storesRepository.findOne({ where: { id: storeId } });
    if (!store) throw new BadRequestException('Store not found');
    return store;
  }

  /** Guards restaurant-only endpoints against being called by a general tenant. */
  async requireRestaurantStore(user: any): Promise<Store> {
    const store = await this.getStore(await this.requireStoreId(user));
    if (store.accountType !== 'restaurant') {
      throw new ForbiddenException('This store is not a restaurant account');
    }
    return store;
  }
}
