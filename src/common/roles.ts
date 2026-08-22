/**
 * The role a user actually acts as in the UI.
 *
 * `User.role` alone is not enough: every restaurant employee is stored as
 * role 'employee', and a store owner's screens depend on their store's
 * account type. This collapses (role x accountType x designation) into the
 * single value both clients route on.
 *
 * `User.role` itself is never rewritten — the general flow keeps reading it.
 */
export type EffectiveRole =
  | 'super_admin'
  | 'store_owner'
  | 'restaurant_owner'
  | 'waiter'
  | 'kitchen'
  | 'cashier';

/** Effective roles that only exist inside a restaurant tenant. */
export const RESTAURANT_ROLES: EffectiveRole[] = [
  'restaurant_owner',
  'waiter',
  'kitchen',
  'cashier',
];

export function resolveEffectiveRole(input: {
  role?: string;
  accountType?: string | null;
  designation?: string | null;
}): EffectiveRole {
  const { role, accountType, designation } = input;

  if (role === 'admin') return 'super_admin';

  if (role === 'store_owner') {
    return accountType === 'restaurant' ? 'restaurant_owner' : 'store_owner';
  }

  // Employees. Only restaurant tenants get waiter/kitchen screens; in a
  // general store a "waiter" designation is just a job title and must still
  // land on the existing POS.
  if (accountType === 'restaurant') {
    const normalized = (designation ?? '').trim().toLowerCase();
    if (normalized === 'waiter') return 'waiter';
    if (normalized === 'kitchen') return 'kitchen';
  }

  // Everything else — including general-store employees with arbitrary
  // free-text designations — keeps today's cashier-style POS access.
  return 'cashier';
}
