import { resolveEffectiveRole } from './roles';

describe('resolveEffectiveRole', () => {
  describe('general accounts must not regress', () => {
    it('keeps a general store owner on the store_owner surface', () => {
      expect(resolveEffectiveRole({ role: 'store_owner', accountType: 'general' })).toBe(
        'store_owner',
      );
    });

    it('treats a store with no accountType as general', () => {
      // Rows that predate the accountType column, or any code path that omits
      // it, must never fall through to a restaurant surface.
      expect(resolveEffectiveRole({ role: 'store_owner' })).toBe('store_owner');
      expect(resolveEffectiveRole({ role: 'store_owner', accountType: null })).toBe(
        'store_owner',
      );
    });

    it('keeps general employees on the cashier surface regardless of designation', () => {
      // `designation` has always been free text, so live data holds arbitrary
      // values. None of them may reroute a general employee.
      for (const designation of ['cashier', 'Manager', 'staff', 'Sales Rep', '', 'waiter']) {
        expect(
          resolveEffectiveRole({ role: 'employee', accountType: 'general', designation }),
        ).toBe('cashier');
      }
    });
  });

  describe('restaurant accounts', () => {
    it('routes the owner to the restaurant surface', () => {
      expect(
        resolveEffectiveRole({ role: 'store_owner', accountType: 'restaurant' }),
      ).toBe('restaurant_owner');
    });

    it.each([
      ['waiter', 'waiter'],
      ['kitchen', 'kitchen'],
      ['cashier', 'cashier'],
    ])('maps designation %s to %s', (designation, expected) => {
      expect(
        resolveEffectiveRole({ role: 'employee', accountType: 'restaurant', designation }),
      ).toBe(expected);
    });

    it('is tolerant of casing and stray whitespace', () => {
      expect(
        resolveEffectiveRole({ role: 'employee', accountType: 'restaurant', designation: ' Waiter ' }),
      ).toBe('waiter');
      expect(
        resolveEffectiveRole({ role: 'employee', accountType: 'restaurant', designation: 'KITCHEN' }),
      ).toBe('kitchen');
    });

    it('falls back to cashier for an unrecognised designation', () => {
      expect(
        resolveEffectiveRole({ role: 'employee', accountType: 'restaurant', designation: 'busser' }),
      ).toBe('cashier');
    });
  });

  it('maps the platform admin role', () => {
    expect(resolveEffectiveRole({ role: 'admin' })).toBe('super_admin');
    // accountType must not affect the admin mapping.
    expect(resolveEffectiveRole({ role: 'admin', accountType: 'restaurant' })).toBe(
      'super_admin',
    );
  });

  it('defaults unknown roles to the least-privileged surface', () => {
    expect(resolveEffectiveRole({ role: 'customer' })).toBe('cashier');
    expect(resolveEffectiveRole({})).toBe('cashier');
  });
});
