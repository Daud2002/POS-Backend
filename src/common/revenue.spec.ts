import {
  platformRevenuePredicate,
  revenueAmountExpr,
  revenuePredicate,
  settledAtExpr,
} from './revenue';

describe('revenue SQL fragments', () => {
  it('settles restaurants by lifecycle and general stores by payment status', () => {
    expect(revenuePredicate('o', 'restaurant')).toBe(
      `("o"."orderStatus" = 'completed' AND ("o"."creditedAt" IS NULL OR "o"."status" = 'paid'))`,
    );
    expect(revenuePredicate('o', 'general')).toBe(`"o"."status" IN ('paid', 'completed')`);
    // Stores that predate the column are general.
    expect(revenuePredicate('o', undefined)).toBe(`"o"."status" IN ('paid', 'completed')`);
  });

  it('decides per row when every store is in one query', () => {
    const predicate = platformRevenuePredicate('o', 's');
    expect(predicate).toContain(
      `"s"."accountType" = 'restaurant' AND ("o"."orderStatus" = 'completed' AND ("o"."creditedAt" IS NULL OR "o"."status" = 'paid'))`,
    );
    expect(predicate).toContain(`"s"."accountType" <> 'restaurant' AND "o"."status" IN ('paid', 'completed')`);
    // Parenthesised as a whole so it can be AND-ed onto other conditions.
    expect(predicate.startsWith('((')).toBe(true);
    expect(predicate.endsWith('))')).toBe(true);
  });

  it('leaves an uncollected credit sale out of restaurant revenue', () => {
    // Only credit rows are filtered: a plain completed order still counts
    // whatever its payment status, exactly as before credit sales existed.
    const restaurant = revenuePredicate('o', 'restaurant');
    expect(restaurant).toContain(`"o"."creditedAt" IS NULL OR "o"."status" = 'paid'`);
    expect(revenuePredicate('o', 'general')).not.toContain('creditedAt');
  });

  it('windows on when the money was taken, falling back to creation', () => {
    expect(settledAtExpr('o')).toBe(`COALESCE("o"."settledAt", "o"."createdAt")`);
  });

  it('counts delivery charges as revenue', () => {
    expect(revenueAmountExpr('o')).toBe(`"o"."total"`);
  });
});
