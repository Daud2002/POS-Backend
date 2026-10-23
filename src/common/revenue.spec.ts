import {
  platformRevenuePredicate,
  revenueAmountExpr,
  revenuePredicate,
  settledAtExpr,
} from './revenue';

describe('revenue SQL fragments', () => {
  it('settles restaurants by lifecycle and general stores by payment status', () => {
    expect(revenuePredicate('o', 'restaurant')).toBe(`"o"."orderStatus" = 'completed'`);
    expect(revenuePredicate('o', 'general')).toBe(`"o"."status" IN ('paid', 'completed')`);
    // Stores that predate the column are general.
    expect(revenuePredicate('o', undefined)).toBe(`"o"."status" IN ('paid', 'completed')`);
  });

  it('decides per row when every store is in one query', () => {
    const predicate = platformRevenuePredicate('o', 's');
    expect(predicate).toContain(`"s"."accountType" = 'restaurant' AND "o"."orderStatus" = 'completed'`);
    expect(predicate).toContain(`"s"."accountType" <> 'restaurant' AND "o"."status" IN ('paid', 'completed')`);
    // Parenthesised as a whole so it can be AND-ed onto other conditions.
    expect(predicate.startsWith('((')).toBe(true);
    expect(predicate.endsWith('))')).toBe(true);
  });

  it('windows on when the money was taken, falling back to creation', () => {
    expect(settledAtExpr('o')).toBe(`COALESCE("o"."settledAt", "o"."createdAt")`);
  });

  it('keeps delivery charges out of revenue', () => {
    expect(revenueAmountExpr('o')).toBe(`("o"."total" - COALESCE("o"."deliveryCharge", 0))`);
  });
});
