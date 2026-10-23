import {
  describeRequest,
  knownAuditActions,
  normalizeRoutePath,
  patternFromParams,
  resolveAuditRoute,
  sanitizePayload,
  type AuditContext,
} from './audit-routes';

const cashier = {
  id: 'user-1',
  name: 'Ayesha',
  email: 'ayesha@example.com',
  role: 'employee',
  effectiveRole: 'cashier',
  storeId: 'store-1',
};

function ctx(overrides: Partial<AuditContext>): AuditContext {
  return {
    method: 'POST',
    routePath: '/',
    params: {},
    body: {},
    response: {},
    user: cashier,
    ...overrides,
  };
}

describe('normalizeRoutePath', () => {
  it('strips the global prefix and trailing slashes', () => {
    expect(normalizeRoutePath('/api/restaurant/orders/:id/punch')).toBe('/restaurant/orders/:id/punch');
    expect(normalizeRoutePath('/api/orders/')).toBe('/orders');
    expect(normalizeRoutePath('orders')).toBe('/orders');
    expect(normalizeRoutePath('/api')).toBe('/');
    // Not a prefix: a module that happens to start with "api".
    expect(normalizeRoutePath('/apiary/x')).toBe('/apiary/x');
  });

  it('rebuilds a pattern from a concrete URL when Express has no route', () => {
    expect(
      patternFromParams('/api/restaurant/orders/abc-123/items', { id: 'abc-123' }),
    ).toBe('/restaurant/orders/:id/items');
  });
});

describe('resolveAuditRoute', () => {
  it('finds known routes regardless of prefix', () => {
    expect(resolveAuditRoute('post', '/api/restaurant/orders/:id/settle').action).toBe('order.settled');
    expect(resolveAuditRoute('POST', '/restaurant/orders/:id/settle').module).toBe('orders');
  });

  it('keeps unknown writes under their method and pattern', () => {
    const route = resolveAuditRoute('POST', '/api/widgets/:id/frobnicate');
    expect(route.module).toBe('widgets');
    expect(route.action).toBe('POST /widgets/:id/frobnicate');
    expect(route.skip).toBeUndefined();
  });

  it('lists every module and action for the filter dropdowns', () => {
    const known = knownAuditActions();
    expect(known.orders).toEqual(expect.arrayContaining(['order.punched', 'order.settled', 'order.draft_created']));
    expect(known.employees).toEqual(expect.arrayContaining(['employee.deactivated']));
    expect(known.auth).toEqual(expect.arrayContaining(['auth.login', 'impersonation.started']));
    expect(known.printing).toBeUndefined();
  });
});

describe('sanitizePayload', () => {
  it('redacts secrets by key wherever they sit', () => {
    const out = sanitizePayload({
      body: { email: 'a@b.c', password: 'hunter2', nested: { accessToken: 'x', refreshToken: 'y', ok: 1 } },
    }) as any;
    expect(out.body.password).toBe('[redacted]');
    expect(out.body.nested.accessToken).toBe('[redacted]');
    expect(out.body.nested.refreshToken).toBe('[redacted]');
    expect(out.body.nested.ok).toBe(1);
    expect(out.body.email).toBe('a@b.c');
  });

  it('drops binary and multer files', () => {
    const out = sanitizePayload({ body: { logo: Buffer.from('abc') }, file: { buffer: Buffer.alloc(10) } }) as any;
    expect(out.body.logo).toBe('[binary]');
    expect(out.file).toBeUndefined();
  });

  it('truncates oversized payloads instead of dropping them', () => {
    const out = sanitizePayload({ body: { notes: 'x'.repeat(5000), items: Array(100).fill({ a: 1 }) } }, 500) as any;
    expect(out._truncated).toBe(true);
    expect(out.preview.length).toBe(500);
  });

  it('returns null for nothing worth keeping', () => {
    expect(sanitizePayload(undefined)).toBeNull();
    expect(sanitizePayload({})).toBeNull();
  });
});

describe('describeRequest', () => {
  it('ignores reads and skipped routes', () => {
    expect(describeRequest(ctx({ method: 'GET', routePath: '/api/orders' }))).toBeNull();
    expect(describeRequest(ctx({ routePath: '/api/auth/refresh' }))).toBeNull();
    expect(describeRequest(ctx({ routePath: '/api/printing/qz/sign' }))).toBeNull();
    expect(describeRequest(ctx({ routePath: '/api/auth/impersonation-links/exchange' }))).toBeNull();
  });

  it('needs an actor to attribute the write to', () => {
    expect(describeRequest(ctx({ routePath: '/api/orders', user: null }))).toBeNull();
  });

  it('describes a punched order with its discount', () => {
    const out = describeRequest(
      ctx({
        routePath: '/api/restaurant/orders/:id/punch',
        params: { id: 'order-9' },
        body: { discountType: 'percent', discountValue: 10 },
        response: { id: 'order-9', orderSequence: 12, total: 1250, items: [{}, {}, {}] },
      }),
    );
    expect(out).toMatchObject({
      module: 'orders',
      action: 'order.punched',
      entityType: 'order',
      entityId: 'order-9',
      storeId: 'store-1',
      actorId: 'user-1',
      actorName: 'Ayesha',
      actorRole: 'cashier',
      impersonatorId: null,
    });
    expect(out?.summary).toBe('Order #12 punched to kitchen (3 items, total 1250.00) with 10% discount');
  });

  it('describes settlement and cancellation', () => {
    const settled = describeRequest(
      ctx({
        routePath: '/api/restaurant/orders/:id/settle',
        params: { id: 'o' },
        body: { paymentMethod: 'card' },
        response: { orderSequence: 3, total: 900, paymentMethod: 'card' },
      }),
    );
    expect(settled?.action).toBe('order.settled');
    expect(settled?.summary).toBe('Order #3 settled (card, total 900.00)');

    const cancelled = describeRequest(
      ctx({ routePath: '/api/restaurant/orders/:id/cancel', params: { id: 'o' }, response: { orderSequence: 3 } }),
    );
    expect(cancelled?.summary).toBe('Order #3 cancelled');
  });

  it('keeps only the shape of a draft autosave', () => {
    const out = describeRequest(
      ctx({
        routePath: '/api/restaurant/orders/:id/draft',
        method: 'PATCH',
        params: { id: 'o' },
        body: { items: [{ productId: 'p', quantity: 2, notes: 'no onions' }], tableId: 't1', version: 4 },
        response: { orderSequence: 7 },
      }),
    );
    expect(out?.action).toBe('order.draft_saved');
    expect(out?.payload).toEqual({ lineCount: 1, tableId: 't1', version: 4 });
  });

  it('records the impersonating admin on the row', () => {
    const out = describeRequest(
      ctx({
        routePath: '/api/products',
        body: { name: 'Zinger', price: 450 },
        user: { ...cashier, impersonatedBy: { id: 'admin-1', name: 'Daud' } },
      }),
    );
    expect(out?.impersonatorId).toBe('admin-1');
    expect(out?.summary).toBe('Product "Zinger" created (price 450.00)');
  });

  it('attributes a login to the user in the response, and keeps no body', () => {
    const out = describeRequest(
      ctx({
        routePath: '/api/auth/login',
        user: null,
        body: { email: 'owner@x.com', password: 'secret' },
        response: { accessToken: 'jwt', user: { id: 'owner-1', name: 'Owner', effectiveRole: 'restaurant_owner', storeId: 'store-2' } },
      }),
    );
    expect(out).toMatchObject({
      module: 'auth',
      action: 'auth.login',
      actorId: 'owner-1',
      actorRole: 'restaurant_owner',
      storeId: 'store-2',
      payload: null,
    });
    expect(out?.summary).toBe('Owner signed in');
  });

  it('takes the store from the route for platform-admin writes', () => {
    const admin = { id: 'admin-1', name: 'Daud', role: 'admin', effectiveRole: 'super_admin' };
    const out = describeRequest(
      ctx({
        routePath: '/api/stores/:id/subscription',
        params: { id: 'store-5' },
        user: admin,
        body: { months: 3, note: 'Paid by bank transfer' },
        response: { store: { id: 'store-5', name: 'Snack Fuel', subscriptionExpiresAt: '2027-01-21' } },
      }),
    );
    expect(out?.module).toBe('subscriptions');
    expect(out?.storeId).toBe('store-5');
    expect(out?.summary).toBe(
      'Subscription of "Snack Fuel" extended by 3 months → paid through 2027-01-21 — Paid by bank transfer',
    );

    const deactivated = describeRequest(
      ctx({ routePath: '/api/users/:id', method: 'PATCH', params: { id: 'u-2' }, user: admin, body: { isActive: false }, response: { name: 'Owner' } }),
    );
    expect(deactivated?.action).toBe('user.deactivated');
    expect(deactivated?.storeId).toBeNull();
  });

  it('never lets a broken summary builder lose the row', () => {
    const out = describeRequest(
      ctx({ routePath: '/api/restaurant/orders/:id/items', params: { id: 'o' }, body: 'not-an-object', response: null }),
    );
    expect(out?.action).toBe('order.items_added');
    expect(out?.summary).toBe('0 items added to order o');
  });

  it('bounds the summary', () => {
    const out = describeRequest(
      ctx({ routePath: '/api/expenses', body: { title: 'x'.repeat(400), amount: 5 } }),
    );
    expect(out?.summary.length).toBeLessThanOrEqual(300);
  });
});
